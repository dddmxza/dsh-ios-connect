/**
 * dsh-ios-connect — 宿主半边。
 *
 * 职责：把一台插在 USB 上的 iPhone 接进 DSH。
 *   1. 找到 go-ios（ios.exe），拉起 tunnel → runwda → 端口转发，断了自动重连；
 *   2. 把 WDA 的 MJPEG 流(/api/dsh-ios-connect.stream)代理给浏览器，侧边栏直接用 <img> 看；
 *   3. 注册一组工具给 agent 用：截图、点、滑、打字、读界面文字。
 *
 * 路由：
 *   GET  /api/dsh-ios-connect.status   当前状态（idle/starting/ready/error）
 *   POST /api/dsh-ios-connect.start    拉起整条链路
 *   POST /api/dsh-ios-connect.stop     全停
 *   GET  /api/dsh-ios-connect.config   读配置（不含敏感项）
 *   POST /api/dsh-ios-connect.config   写配置
 *   GET  /api/dsh-ios-connect.stream   MJPEG 实时画面
 *   GET  /api/dsh-ios-connect.frame    单帧 JPEG
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureIos, ensureDdi, findPython } from './deps.js'
import { findSigner, ipaPath, downloadIloader, ILOADER_PAGE } from './signer.js'

export const name = 'dsh-ios-connect'
export const inject = ['tools', 'webServer']

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const RUNTIME = path.join(ROOT, '.runtime')
const CONFIG_PATH = path.join(ROOT, 'config.json')

const DEFAULTS = {
  iosPath: '',        // go-ios 的 ios.exe；留空则自动找
  udid: '',           // 手机 UDID；留空则用连上的第一台
  bundleId: '',       // WDA 的包名；留空则启动时现查（重签后会变）
  wdaPort: 8100,
  mjpegPort: 9100,
  dataDir: '',        // 截图落盘位置；留空用插件目录下 .data
  autoDownload: true, // 缺 go-ios 时允许自己下
  // 实时画面的清晰度取舍。侧栏就那么宽，让手机端直接按接近显示宽度出图，
  // 比出 828 宽再让浏览器缩小要清楚得多（缩小那一步就是糊的根源）。
  streamScale: 50,    // 1-100，100=原尺寸，50=一半（828→414）
  streamQuality: 65,  // 1-100，越大越清也越占带宽
  streamFps: 20,      // 帧率上限
  passcode: '',       // 锁屏密码，只有 phone_unlock 用；留空就只点亮+上滑
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch }
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + '\n', 'utf8')
  } catch (e) {
    console.error('[dsh-ios-connect] 配置写不进去：', e.message)
  }
  return next
}

/**
 * 签名这一关的现状。面板拿它决定要不要显示「去装签名工具」。
 * 每次都现查 —— 用户可能刚装完 iloader，缓存了会骗人。
 */
function signerState() {
  const found = findSigner()
  const ipa = ipaPath(ROOT)
  let ipaReady = false
  try {
    ipaReady = fs.statSync(ipa).isFile()
  } catch {}
  return {
    installed: found.installed,
    name: found.name,
    path: found.path,
    ipa,
    ipaReady,
    url: ILOADER_PAGE,
  }
}

/** 运行期状态。侧边栏只看这个。 */
const state = {
  phase: 'idle',      // idle | starting | ready | error
  message: '还没启动',
  udid: '',
  bundleId: '',
  iosPath: '',
  deps: { stage: '', percent: 0, version: '' },  // 依赖这一摊的进度，面板拿它显示
  children: [],
}

let starting = null

function setState(patch) {
  Object.assign(state, patch)
}

//#region 找 ios.exe

/** 自己走一遍 PATH，不依赖 shell 的 which。 */
function whichSync(bin) {
  const paths = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of paths) {
    for (const ext of exts) {
      const full = path.join(dir, bin + ext)
      try {
        if (fs.statSync(full).isFile()) return full
      } catch {}
    }
  }
  return ''
}

function findIos(cfg) {
  const tried = []
  const candidates = [
    cfg.iosPath,
    path.join(RUNTIME, 'bin', 'ios.exe'),
    process.env.DSH_IOS_PATH || '',
    whichSync('ios'),
    path.join(ROOT, 'bin', 'ios.exe'),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'SideTap', 'bin', 'ios.exe') : '',
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'ios.exe') : '',
  ]
  for (const c of candidates) {
    if (!c) continue
    tried.push(c)
    try {
      if (fs.statSync(c).isFile()) return { path: c, tried }
    } catch {}
  }
  return { path: '', tried }
}

//#endregion

//#region go-ios 调用

function iosEnv(cfg) {
  return {
    ...process.env,
    GO_IOS_AGENT_PORT: cfg.agentPort || '28100',
    ENABLE_GO_IOS_AGENT: 'user',
  }
}

/** 同步跑一条 go-ios 命令，返回 { ok, out }。 */
function iosRun(cfg, args, timeoutMs = 60000) {
  const env = iosEnv(cfg)
  const r = spawnSync(cfg._iosPath || state.iosPath, args, {
    encoding: 'utf8',
    env,
    timeout: timeoutMs,
    windowsHide: true,
  })
  const out = `${r.stdout || ''}${r.stderr || ''}`
  return { ok: r.status === 0, out, status: r.status }
}

function spawnHidden(cfg, args) {
  const child = spawn(cfg._iosPath || state.iosPath, args, {
    detached: true,
    stdio: 'ignore',
    env: iosEnv(cfg),
    windowsHide: true,
  })
  child.unref()
  state.children.push(child.pid)
  return child.pid
}

//#endregion

//#region 找手机与包名

function resolveUdid(cfg) {
  if (cfg.udid) return cfg.udid
  const { ok, out } = iosRun(cfg, ['list'], 30000)
  if (!ok) return ''
  // 输出形如 JSON 数组，也见过逐行的表；两种都啃
  const ids = [...out.matchAll(/[0-9A-F]{8}-[0-9A-F]{16}/gi)].map((m) => m[0].toUpperCase())
  const uniq = [...new Set(ids)]
  return uniq[0] || ''
}

function resolveBundleId(cfg, udid) {
  if (cfg.bundleId) return cfg.bundleId
  const { out } = iosRun(cfg, ['apps', '--list', '--udid', udid], 120000)
  const mt = out.match(/([\w.\-]*WebDriverAgentRunner[\w.\-]*)\s+WebDriverAgentRunner/)
  if (mt) return mt[1]
  const any = out.match(/com\.[\w.\-]+\.xctrunner\.[0-9A-Z]+/)
  return any ? any[0] : ''
}

//#endregion

//#region 链路启停

function waitFor(port, host = '127.0.0.1', timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.request({ host, port, path: '/status', method: 'GET', timeout: 4000 }, (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => {
          try {
            const v = JSON.parse(body).value
            if (v && v.ready !== undefined) return resolve(true)
          } catch {}
          resolve(false)
        })
      })
      req.on('error', () => {
        if (Date.now() > deadline) resolve(false)
        else setTimeout(tick, 2000)
      })
      req.on('timeout', () => {
        req.destroy()
        if (Date.now() > deadline) resolve(false)
        else setTimeout(tick, 2000)
      })
      req.end()
    }
    tick()
  })
}

function killChildren() {
  for (const pid of state.children) {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true })
      else process.kill(pid, 'SIGKILL')
    } catch {}
  }
  state.children = []
}

async function startChain(force = false) {
  if (starting && !force) return starting
  starting = (async () => {
    const cfg = loadConfig()
    forgetSession()
    setState({ phase: 'starting', message: '正在找 go-ios', deps: { stage: 'go-ios', percent: 0, version: '' } })

    // 1) go-ios：优先用现成的，缺了才下。进度写进 state，面板能显示百分比。
    const ensured = await ensureIos({
      runtimeDir: RUNTIME,
      pluginRoot: ROOT,
      allowDownload: cfg.autoDownload !== false,
      onProgress: (got, total) => {
        const pct = total ? Math.min(100, Math.round((got / total) * 100)) : 0
        setState({ message: `正在下载 go-ios ${pct}%`, deps: { stage: 'download', percent: pct, version: '' } })
      },
    })
    if (!ensured.ok) {
      setState({ phase: 'error', message: ensured.message || 'go-ios 没准备好' })
      return { ok: false, message: ensured.message }
    }
    const iosPath = ensured.path
    cfg._iosPath = iosPath
    setState({
      iosPath,
      message: '正在找手机',
      deps: { stage: 'go-ios', percent: 100, version: ensured.version || '' },
    })

    const udid = resolveUdid(cfg)
    if (!udid) {
      const msg = '没认出手机。插线、解锁、手机上点「信任」，然后重试。'
      setState({ phase: 'error', message: msg })
      return { ok: false, message: msg }
    }
    setState({ udid, message: '正在起隧道' })

    spawnHidden(cfg, ['tunnel', 'start', '--userspace'])
    await new Promise((r) => setTimeout(r, 8000))

    // 2) 开发者镜像。挂不上 WDA 一定起不来，所以在 runwda 之前解决。
    setState({ message: '正在准备开发者镜像' })
    const ddi = ensureDdi({
      iosPath,
      python: findPython(),
      venvDir: path.join(RUNTIME, 'py'),
      onStep: (s) => setState({ message: s }),
    })
    if (!ddi.ok) {
      setState({ phase: 'error', message: ddi.message })
      return { ok: false, message: ddi.message }
    }

    setState({ message: '正在查 WebDriverAgent' })
    const bundleId = resolveBundleId(cfg, udid)
    if (!bundleId) {
      const s = signerState()
      const msg =
        '手机上没找到 WebDriverAgent（那个把手机变成「能动」的控制器）。这件事插件替不了你，要你的 Apple ID 签一次：' +
        `① 用签名工具装 ${s.ipa}；② 装完去 设置→通用→VPN与设备管理 点信任；③ 回来点连接。` +
        (s.installed ? `签名工具已经有了（${s.name}）。` : '签名工具还没装，面板上能一键下载。')
      setState({ phase: 'error', message: msg })
      return { ok: false, message: msg }
    }
    setState({ bundleId, message: '正在起 WDA' })

    spawnHidden(cfg, [
      'runwda',
      `--bundleid=${bundleId}`,
      `--testrunnerbundleid=${bundleId}`,
      '--xctestconfig=WebDriverAgentRunner.xctest',
    ])
    await new Promise((r) => setTimeout(r, 10000))

    spawnHidden(cfg, ['forward', String(cfg.wdaPort), String(cfg.wdaPort)])
    spawnHidden(cfg, ['forward', String(cfg.mjpegPort), String(cfg.mjpegPort)])

    const ok = await waitFor(cfg.wdaPort, '127.0.0.1', 90000)
    if (!ok) {
      const msg =
        `WDA 起来了但连不上（${cfg.wdaPort} 端口）。最常见两个原因：` +
        '①证书没信任 —— 设置→通用→VPN与设备管理 里点一下你的 Apple ID；' +
        '②免费签名过期了（7 天）—— 重签一次再试。'
      setState({ phase: 'error', message: msg })
      return { ok: false, message: msg }
    }
    await applyStreamSettings(cfg)
    setState({ phase: 'ready', message: '已连接' })
    return { ok: true, message: '已连接', udid, bundleId }
  })().finally(() => {
    starting = null
  })
  return starting
}

async function stopChain() {
  killChildren()
  forgetSession()
  setState({ phase: 'idle', message: '已停止' })
  return { ok: true, message: '已停止' }
}

//#endregion

//#region WDA HTTP

function wdaRequest(cfg, method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body)
    const req = http.request(
      {
        host: '127.0.0.1',
        port: cfg.wdaPort,
        path: p,
        method,
        timeout: 45000,
        headers: payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let raw = ''
        res.on('data', (c) => (raw += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw))
          } catch {
            reject(new Error(`WDA 返回的不是 JSON：${raw.slice(0, 200)}`))
          }
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('WDA 超时')))
    if (payload) req.write(payload)
    req.end()
  })
}

let sessionId = ''

/**
 * WDA 重起、手机重连、隔夜回来，浏览器那边会话全废，旧 id 一律回
 * 404「invalid session id」。这时必须把它忘掉重新开一个，否则截图永远是空的。
 */
function forgetSession() {
  sessionId = ''
}

function isDeadSession(r) {
  return !!(r && r.value && r.value.error === 'invalid session id')
}

/**
 * 调 WDA 自己的 MJPEG 参数。这几个值只活在 WDA 进程内存里，WDA 一重启就回默认，
 * 所以每次起链路都得重设一遍。调不动也不影响能用，失败就悄悄回默认。
 */
async function applyStreamSettings(cfg) {
  const n = (v, lo, hi, d) => {
    const x = Number(v)
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d
  }
  const settings = {
    mjpegScalingFactor: n(cfg.streamScale, 1, 100, 50),
    mjpegServerScreenshotQuality: n(cfg.streamQuality, 1, 100, 65),
    mjpegServerFramerate: n(cfg.streamFps, 1, 60, 20),
  }
  try {
    const st = await wdaRequest(cfg, 'GET', '/status')
    const sid = st.sessionId || (st.value && st.value.sessionId) || ''
    if (!sid) return null
    await wdaRequest(cfg, 'POST', `/session/${sid}/appium/settings`, { settings })
    return settings
  } catch {
    return null
  }
}

//#region 读界面、找控件

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 把 WDA 的控件树拍平成一串带坐标的元素。
 * 坐标是屏幕绝对坐标（单位 point），中心的那个点就是能点的地方。
 */
function parseElements(xml) {
  const out = []
  const re = /<XCUIElementType([A-Za-z]+)\b([^>]*)>/g
  let m
  while ((m = re.exec(xml))) {
    const attrs = m[2]
    const attr = (k) => {
      const a = new RegExp(`\\b${k}="([^"]*)"`).exec(attrs)
      return a ? a[1] : ''
    }
    const num = (k) => {
      const v = Number(attr(k))
      return Number.isFinite(v) ? v : 0
    }
    const w = num('width')
    const h = num('height')
    if (w <= 0 || h <= 0) continue // 没尺寸的容器点了也没意义
    if (attr('visible') === 'false') continue
    const x = num('x')
    const y = num('y')
    out.push({
      type: m[1],
      name: attr('name'),
      label: attr('label'),
      value: attr('value'),
      x,
      y,
      w,
      h,
      cx: Math.round(x + w / 2),
      cy: Math.round(y + h / 2),
    })
  }
  return out
}

/** 控件上的文字对不对得上。exact 要一模一样，否则包含就算。 */
function matchElement(el, text, exact) {
  const hay = [el.name, el.label, el.value].filter(Boolean)
  if (exact) return hay.some((s) => s === text)
  const t = text.toLowerCase()
  return hay.some((s) => s.toLowerCase().includes(t))
}

function textOf(el) {
  return el.name || el.label || el.value || ''
}

async function readSource() {
  const r = await withSession((c, sid) => wdaRequest(c, 'GET', `/session/${sid}/source`))
  return typeof r.value === 'string' ? r.value : ''
}

async function pressHomeButton() {
  await withSession((c, sid) => wdaRequest(c, 'POST', `/session/${sid}/wda/pressButton`, { name: 'home' }))
}

async function windowSize() {
  const r = await withSession((c, sid) => wdaRequest(c, 'GET', `/session/${sid}/window/size`))
  const v = r.value || {}
  return { w: Number(v.width) || 414, h: Number(v.height) || 896 }
}

async function swipePoints(x1, y1, x2, y2, ms) {
  const body = {
    actions: [
      {
        type: 'pointer',
        id: 'finger',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: x1, y: y1 },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerMove', duration: ms, x: x2, y: y2 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  }
  await withSession((c, sid) => wdaRequest(c, 'POST', `/session/${sid}/actions`, body))
}

async function tapPoint(x, y, hold) {
  const body = {
    actions: [
      {
        type: 'pointer',
        id: 'finger',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x, y },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: hold || 80 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  }
  await withSession((c, sid) => wdaRequest(c, 'POST', `/session/${sid}/actions`, body))
}

/** 现在是不是在锁屏界面。 */
function looksLocked(xml) {
  return /SBCoverSheetWindow|LockScreen|PasscodeKeypad|SBLockScreen/i.test(xml)
}

//#endregion

async function ensureSession() {
  const cfg = loadConfig()
  if (sessionId) return sessionId
  const r = await wdaRequest(cfg, 'POST', '/session', {
    capabilities: { alwaysMatch: { shouldWaitForQuiescence: false } },
  })
  sessionId = r.sessionId || (r.value && r.value.sessionId) || ''
  if (!sessionId) throw new Error('WDA 没给 sessionId')
  return sessionId
}

/** 发请求；撞上失效会话就重开一次再发，最多重一次免得死循环。 */
async function withSession(fn) {
  let sid = await ensureSession()
  let r = await fn(loadConfig(), sid)
  if (isDeadSession(r)) {
    forgetSession()
    sid = await ensureSession()
    r = await fn(loadConfig(), sid)
  }
  return r
}

/** 手机坐标是 point，截图是像素，比例是 scale（一般是 2）。 */
async function screenScale() {
  const cfg = loadConfig()
  const sid = await ensureSession()
  const size = await wdaRequest(cfg, 'GET', `/session/${sid}/window/size`)
  const w = (size.value && size.value.width) || 0
  return { points: w, scale: w && 414 ? 414 / w : 1 }
}

//#endregion

//#region 工具

const jsonOut = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve({})
      }
    })
  })
}

function dataDir() {
  const cfg = loadConfig()
  const dir = cfg.dataDir || path.join(ROOT, '.data')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {}
  return dir
}

// WDA 在 iOS 17+ 的 /screenshot 回的是 PNG，不是 JPEG。
// 别信后缀，看头几个字节定格式，否则存出来的 .jpg 其实是 PNG，看图会报错。
function sniffImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { ext: 'png', mime: 'image/png' }
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) {
    return { ext: 'jpg', mime: 'image/jpeg' }
  }
  return { ext: 'bin', mime: 'application/octet-stream' }
}

//#endregion

export function apply(ctx) {
  // ---- 路由 ----
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-ios-connect.status',
    handler: (req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ...state, children: undefined, signer: signerState() }))
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-ios-connect.start',
    handler: async (req, res) => {
      const r = await startChain()
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ...r, state: { ...state, children: undefined, signer: signerState() } }))
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-ios-connect.stop',
    handler: async (req, res) => {
      const r = await stopChain()
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(r))
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-ios-connect.config',
    handler: async (req, res) => {
      if (req.method === 'POST') {
        const body = await readBody(req)
        const patch = {}
        for (const k of ['iosPath', 'udid', 'bundleId', 'dataDir']) {
          if (typeof body[k] === 'string') patch[k] = body[k].trim()
        }
        for (const k of ['wdaPort', 'mjpegPort']) {
          if (Number.isInteger(body[k])) patch[k] = body[k]
        }
        if (typeof body.autoDownload === 'boolean') patch.autoDownload = body.autoDownload
        saveConfig(patch)
      }
      const cfg = loadConfig()
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(cfg))
    },
  })

  // 签名工具：只下载，不安装。装它要 UAC，插件没这个权限，也不该有。
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-ios-connect.signer',
    handler: async (req, res) => {
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(obj))
      }
      if (req.method !== 'POST') return send(200, signerState())
      const s = signerState()
      if (s.installed) return send(200, { ok: true, message: `已经装了：${s.name}`, signer: s })
      const r = await downloadIloader({
        onProgress: (got, total) => {
          const pct = total ? Math.round((got / total) * 100) : 0
          setState({ deps: { stage: 'signer', percent: pct, version: '' } })
        },
      })
      setState({ deps: { stage: '', percent: 0, version: '' } })
      return send(200, { ...r, signer: signerState() })
    },
  })

  // MJPEG 原样代理：同源，侧边栏 <img> 直接吃，不碰跨域
  ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-ios-connect.stream',
    handler: (req, res) => {
      const cfg = loadConfig()
      if (state.phase !== 'ready') {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(state.message)
        return
      }
      const up = http.request(
        { host: '127.0.0.1', port: cfg.mjpegPort, path: '/', method: 'GET' },
        (pres) => {
          res.writeHead(pres.statusCode || 200, {
            'Content-Type': pres.headers['content-type'] || 'multipart/x-mixed-replace; boundary=--BoundaryString',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
          })
          pres.pipe(res)
          pres.on('error', () => res.end())
        },
      )
      up.on('error', () => {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('画面流没接上：' + state.message)
      })
      req.on('close', () => up.destroy())
      up.end()
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: '/api/dsh-ios-connect.frame',
    handler: async (req, res) => {
      try {
        const r = await withSession((cfg, sid) => wdaRequest(cfg, 'GET', `/session/${sid}/screenshot`))
        const b64 = typeof r.value === 'string' ? r.value : ''
        if (!b64) throw new Error('WDA 没给图')
        const buf = Buffer.from(b64, 'base64')
        const img = sniffImage(buf)
        res.writeHead(200, { 'Content-Type': img.mime, 'Cache-Control': 'no-store' })
        res.end(buf)
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('截图失败：' + e.message)
      }
    },
  })

  // ---- 工具 ----
  ctx.tools.register(
    defineTool({
      name: 'phone_status',
      description: '查 iPhone 连接状态：链路通不通、UDID、WebDriverAgent 包名、当前提示。',
      parameters: {},
      output: jsonOut,
      async execute() {
        const cfg = loadConfig()
        const found = findIos(cfg)
        return {
          phase: state.phase,
          message: state.message,
          udid: state.udid,
          bundleId: state.bundleId,
          iosPath: found.path || '(缺)',
          deps: state.deps,
          wdaPort: cfg.wdaPort,
          signer: signerState(),
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'phone_start',
      description: '拉起手机链路（隧道 + WebDriverAgent + 端口转发）。已经通了就什么都不做。',
      parameters: {},
      output: jsonOut,
      async execute() {
        if (state.phase === 'ready') return { ok: true, message: '本来就是通的' }
        return await startChain()
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'phone_screenshot',
      description: '截一张手机屏，存成 jpg，返回文件路径和屏幕尺寸。看图用 read_image 打开这个路径。',
      parameters: {},
      output: jsonOut,
      async execute() {
        const cfg = loadConfig()
        if (state.phase !== 'ready') {
          const r = await startChain()
          if (!r.ok) return { ok: false, message: r.message }
        }
        const shot = await withSession((c, sid) => wdaRequest(c, 'GET', `/session/${sid}/screenshot`))
        const b64 = typeof shot.value === 'string' ? shot.value : ''
        if (!b64) return { ok: false, message: 'WDA 没给图' }
        const dir = dataDir()
        const img = sniffImage(Buffer.from(b64, 'base64'))
        const file = path.join(dir, `shot-${Date.now()}.${img.ext}`)
        fs.writeFileSync(file, Buffer.from(b64, 'base64'))
        const size = await withSession((c, sid) => wdaRequest(c, 'GET', `/session/${sid}/window/size`))
        return {
          ok: true,
          file,
          points: size.value,
          hint: '手机坐标单位是 point，点的时候按 points 里的宽高算，不要用图片像素。',
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'phone_tap',
      description: '点手机屏幕上的一点。坐标单位是 point（不是截图像素，point 宽一般是 414）。',
      parameters: {
        x: { type: 'number', description: 'x，单位 point' },
        y: { type: 'number', description: 'y，单位 point' },
        duration: { type: 'number', description: '按住多少毫秒，默认 80；长按给 800 以上' },
      },
      output: jsonOut,
      async execute(args) {
        const cfg = loadConfig()
        const hold = Number.isFinite(args.duration) ? args.duration : 80
        const body = {
          actions: [
            {
              type: 'pointer',
              id: 'finger',
              parameters: { pointerType: 'touch' },
              actions: [
                { type: 'pointerMove', duration: 0, x: args.x, y: args.y },
                { type: 'pointerDown', button: 0 },
                { type: 'pause', duration: hold },
                { type: 'pointerUp', button: 0 },
              ],
            },
          ],
        }
        try {
          await withSession((c, sid) => wdaRequest(c, 'POST', `/session/${sid}/actions`, body))
          return { ok: true, message: `点了 (${args.x}, ${args.y})` }
        } catch (e) {
          return { ok: false, message: e.message }
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'phone_swipe',
      description: '在手机屏幕上滑一下。坐标单位 point。',
      parameters: {
        x1: { type: 'number', description: '起点 x' },
        y1: { type: 'number', description: '起点 y' },
        x2: { type: 'number', description: '终点 x' },
        y2: { type: 'number', description: '终点 y' },
        duration: { type: 'number', description: '滑多久，默认 300 毫秒' },
      },
      output: jsonOut,
      async execute(args) {
        const cfg = loadConfig()
        const ms = Number.isFinite(args.duration) ? args.duration : 300
        const body = {
          actions: [
            {
              type: 'pointer',
              id: 'finger',
              parameters: { pointerType: 'touch' },
              actions: [
                { type: 'pointerMove', duration: 0, x: args.x1, y: args.y1 },
                { type: 'pointerDown', button: 0 },
                { type: 'pointerMove', duration: ms, x: args.x2, y: args.y2 },
                { type: 'pointerUp', button: 0 },
              ],
            },
          ],
        }
        try {
          await withSession((c, sid) => wdaRequest(c, 'POST', `/session/${sid}/actions`, body))
          return { ok: true, message: `从 (${args.x1},${args.y1}) 滑到 (${args.x2},${args.y2})` }
        } catch (e) {
          return { ok: false, message: e.message }
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'phone_type',
      description: '往当前聚焦的输入框打字。先点一下输入框再调这个。',
      parameters: {
        text: { type: 'string', description: '要打的字' },
      },
      output: jsonOut,
      async execute(args) {
        const cfg = loadConfig()
        try {
          await withSession((c, sid) => wdaRequest(c, 'POST', `/session/${sid}/wda/keys`, { value: [...String(args.text)] }))
          return { ok: true, message: '打完了' }
        } catch (e) {
          return { ok: false, message: e.message }
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'phone_ui',
      description: '把当前界面的控件树读出来（XML），每个控件带名字和坐标，用来找准要点哪里。',
      parameters: {},
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean' }, xml: { type: 'string' }, message: { type: 'string' } }, additionalProperties: true },
        render: (_args, v) => [{ type: 'text', text: v.ok ? v.xml.slice(0, 20000) : v.message }],
      },
      async execute() {
        const cfg = loadConfig()
        try {
          const r = await withSession((c, sid) => wdaRequest(c, 'GET', `/session/${sid}/source`))
          return { ok: true, xml: typeof r.value === 'string' ? r.value : JSON.stringify(r.value) }
        } catch (e) {
          return { ok: false, message: e.message }
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'phone_find',
      description:
        '按文字在屏幕上找控件，直接给出能点的坐标（point）。比 phone_ui 省事：只回匹配的那几个，不用把整棵树倒出来。',
      parameters: {
        text: { type: 'string', description: '控件上的文字，可以只给一部分' },
        exact: { type: 'boolean', description: '要不要完全一样才算，默认只要包含就算' },
      },
      output: jsonOut,
      async execute(args) {
        const text = String(args.text ?? '').trim()
        if (!text) return { ok: false, message: '要给个要搜的文字' }
        try {
          const hits = parseElements(await readSource()).filter((e) => matchElement(e, text, !!args.exact))
          if (!hits.length) {
            return { ok: false, count: 0, message: `屏幕上没找到「${text}」`, hint: '可能还没到那个界面，先用 phone_ui 看一眼现在是什么页' }
          }
          const matches = hits.slice(0, 8).map((e) => ({ text: textOf(e), type: e.type, x: e.cx, y: e.cy }))
          return {
            ok: true,
            count: hits.length,
            matches,
            hint:
              hits.length === 1
                ? `就用 phone_tap x=${hits[0].cx} y=${hits[0].cy}`
                : '有好几个，挑一个坐标用 phone_tap；想更准可以加 exact 或换长一点的文字',
          }
        } catch (e) {
          return { ok: false, message: e.message }
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'phone_wait',
      description:
        '等界面变化。给了 text 就等这段文字出现；没给就等画面稳定下来。用来代替反复截图确认。',
      parameters: {
        text: { type: 'string', description: '等这段文字出现，可以只给一部分' },
        timeout: { type: 'number', description: '最多等多少毫秒，默认 15000' },
      },
      output: jsonOut,
      async execute(args) {
        const text = args.text ? String(args.text).trim() : ''
        const budget = Number.isFinite(args.timeout) ? args.timeout : 15000
        const began = Date.now()
        const left = () => budget - (Date.now() - began)
        let last = ''
        let same = 0
        let lastError = ''
        while (left() > 0) {
          let xml = ''
          try {
            xml = await readSource()
          } catch (e) {
            lastError = e.message
            await sleep(400)
            continue
          }
          if (text) {
            if (parseElements(xml).some((el) => matchElement(el, text, false))) {
              return { ok: true, found: true, waitedMs: Date.now() - began, message: `「${text}」出现了` }
            }
          } else if (xml && xml === last) {
            if (++same >= 2) return { ok: true, found: false, waitedMs: Date.now() - began, message: '画面稳定了' }
          } else {
            same = 0
            last = xml
          }
          await sleep(400)
        }
        return {
          ok: false,
          found: false,
          waitedMs: Date.now() - began,
          message: text ? `等了 ${budget}ms 也没等到「${text}」` : `等了 ${budget}ms 画面一直在变`,
          lastError: lastError || undefined,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'phone_launch',
      description: '按包名直接打开一个 App。比在桌面找图标稳：图标会翻页、会挪位置，包名不会变。',
      parameters: {
        bundleId: { type: 'string', description: 'App 的包名，例如小红书是 com.xingin.discover' },
      },
      output: jsonOut,
      async execute(args) {
        const bundleId = String(args.bundleId ?? '').trim()
        if (!bundleId) return { ok: false, message: '要给包名' }
        try {
          const r = await withSession((c, sid) =>
            wdaRequest(c, 'POST', `/session/${sid}/wda/apps/launch`, { bundleId }),
          )
          if (r && r.value && r.value.error) {
            const msg = String(r.value.message || '')
            if (/unlocked|Locked/i.test(msg)) {
              return { ok: false, message: '手机锁着，App 起不来。先 phone_unlock，再调这个。' }
            }
            return { ok: false, message: `打不开：${msg.slice(0, 200)}` }
          }
          await sleep(1200)
          return { ok: true, message: `打开了 ${bundleId}` }
        } catch (e) {
          return { ok: false, message: e.message }
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'phone_home',
      description: '回到桌面（相当于按一下 Home）。',
      parameters: {},
      output: jsonOut,
      async execute() {
        try {
          await pressHomeButton()
          await sleep(700)
          return { ok: true, message: '已回桌面' }
        } catch (e) {
          return { ok: false, message: e.message }
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'phone_unlock',
      description:
        '把手机解锁：点亮屏幕、上滑、输密码。密码要事先写进 config.json 的 passcode，没写就只做前两步。',
      parameters: {},
      output: jsonOut,
      async execute() {
        const cfg = loadConfig()
        try {
          let xml = await readSource()
          if (!looksLocked(xml)) return { ok: true, message: '手机本来就醒着，不用解锁' }

          await pressHomeButton() // 锁屏时按一下是点亮
          await sleep(700)
          xml = await readSource()

          // 上滑露出密码键盘
          const { w, h } = await windowSize()
          await swipePoints(Math.round(w * 0.5), Math.round(h * 0.88), Math.round(w * 0.5), Math.round(h * 0.34), 320)
          await sleep(900)

          const passcode = String(cfg.passcode || '').trim()
          if (!passcode) {
            return {
              ok: true,
              unlocked: false,
              message: '点亮并上滑了。手机有密码的话得你自己输——把密码写进 config.json 的 passcode，我就能替你输。',
            }
          }

          for (const digit of passcode) {
            const key = parseElements(await readSource()).find(
              (el) => textOf(el) === digit && el.cx > 0 && el.cy > 0,
            )
            if (!key) {
              return { ok: false, message: `密码键盘上找不到「${digit}」，可能这次是图案或者指纹。你自己解一下。` }
            }
            await tapPoint(key.cx, key.cy, 60)
            await sleep(220)
          }
          await sleep(1200)
          const after = await readSource()
          return {
            ok: true,
            unlocked: !looksLocked(after),
            message: looksLocked(after) ? '密码输完了但还停在锁屏，自己看一眼' : '解锁了',
          }
        } catch (e) {
          return { ok: false, message: e.message }
        }
      },
    }),
  )

  // 插件加载时如果链路是通的，什么都不做；只有面板点「连接」才拉起来。
  if (state.phase === 'idle') setState({ message: '还没启动' })
}
