/**
 * dsh-ios-connect — 依赖自理。
 *
 * 这个文件只干一件事：当用户机器上缺东西时，插件自己把缺的补上，
 * 而不是把「你先去装个 xxx」甩给用户。
 *
 * 三类依赖：
 *   1. go-ios（ios.exe，22.6 MB）—— 从 GitHub release 下，解压到 .runtime/bin/
 *   2. 开发者镜像（DDI）—— 手机上没挂的时候 go-ios 挂不上，改走 pymobiledevice3
 *   3. pymobiledevice3 —— 只在真的撞上证书问题时才装，装进 .runtime/venv
 *
 * 几个已经踩过的坑，写在这里防止以后改回去：
 *   - 不能用 PowerShell 的 Invoke-WebRequest 下载：这台机器上它连 GitHub 的 TLS 都握不上手。
 *   - 不能用 PowerShell 解压：中文路径会变成乱码（素材 -> 绱犳潗）。
 *   - 下载地址不能写 latest：release 结构一变就炸，钉死版本号。
 *   - 23 MB 的 exe 不进 npm 包，也不进 git，只能运行时取。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'

/** 钉死的 go-ios 版本。升级时改这两个常量，别改成 latest。 */
export const GO_IOS_VERSION = 'v1.3.2'
const GH_PATH = `danielpaulus/go-ios/releases/download/${GO_IOS_VERSION}/go-ios-win.zip`
export const GO_IOS_URL = `https://github.com/${GH_PATH}`
/** 校验用：zip 的总字节数。对不上就当下载坏了。 */
export const GO_IOS_ZIP_BYTES = 8824605

/**
 * 下载源，按顺序试，哪个通用哪个。
 * 直连排第一（有梯子的机器一次就中），后面两个是国内的 GitHub 反代：
 *   ghfast.top / gh-proxy.com 实测都能原样吐出 8824605 字节。
 * 注意 go 的模块代理（goproxy.cn）不能用来下这个 —— 它只给源码，编译得自己来。
 */
export const GO_IOS_SOURCES = [
  GO_IOS_URL,
  `https://ghfast.top/https://github.com/${GH_PATH}`,
  `https://gh-proxy.com/https://github.com/${GH_PATH}`,
]

/** pymobiledevice3 装它是因为 go-ios 挂 DDI 时要现算苹果的 TLS 签名，系统证书库缺 Apple 根就死。 */
export const PYPI_INDEX = 'https://mirrors.aliyun.com/pypi/simple/'
export const PY_PACKAGE = 'pymobiledevice3'

const IS_WIN = process.platform === 'win32'

//#region 小工具

function exists(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function mkdirp(p) {
  try {
    fs.mkdirSync(p, { recursive: true })
  } catch {}
}

/**
 * 带重定向的 GET。GitHub 的 release 会跳到 release-assets.githubusercontent.com，
 * 且带签名参数，必须原样跟着跳。
 */
export function httpGet(url, { onProgress, timeoutMs = 120000, redirects = 6 } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http
    const req = mod.request(
      url,
      {
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'dsh-ios-connect',
          Accept: 'application/octet-stream',
        },
      },
      (res) => {
        const code = res.statusCode || 0
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && redirects > 0) {
          res.resume()
          const next = new URL(res.headers.location, url).href
          return resolve(httpGet(next, { onProgress, timeoutMs, redirects: redirects - 1 }))
        }
        if (code !== 200) {
          res.resume()
          return reject(new Error(`下载返回 HTTP ${code}：${url}`))
        }
        const total = Number(res.headers['content-length'] || 0)
        const chunks = []
        let got = 0
        res.on('data', (c) => {
          chunks.push(c)
          got += c.length
          if (onProgress) onProgress(got, total)
        })
        res.on('end', () => resolve(Buffer.concat(chunks)))
        res.on('error', reject)
      },
    )
    req.on('error', (e) => reject(new Error(`下载失败：${e.message}`)))
    req.on('timeout', () => req.destroy(new Error('下载超时')))
    req.end()
  })
}

/** 找系统里现成的 python 3。 */
export function findPython() {
  const tries = IS_WIN ? ['python.exe', 'python3.exe', 'py.exe'] : ['python3', 'python']
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const t of tries) {
    for (const dir of dirs) {
      const full = path.join(dir, t)
      if (!exists(full)) continue
      const r = spawnSync(full, ['-c', 'import sys;print(sys.version_info[0])'], {
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true,
      })
      if (r.status === 0 && String(r.stdout).trim() === '3') return full
    }
  }
  return ''
}

//#endregion

//#region 解压

/**
 * 解 zip。
 * 优先系统自带的 tar.exe（Win10 1803+ 都有，且它会识别 zip）；
 * 不行就自己用 zlib 拆。**绝不调 PowerShell** —— 中文路径会坏。
 */
export function unzip(zipPath, destDir) {
  mkdirp(destDir)
  const tarTry = spawnSync('tar', ['-xf', zipPath, '-C', destDir], {
    encoding: 'utf8',
    timeout: 180000,
    windowsHide: true,
  })
  if (tarTry.status === 0) return { ok: true, how: 'tar' }

  try {
    unzipJs(zipPath, destDir)
    return { ok: true, how: 'js' }
  } catch (e) {
    return {
      ok: false,
      how: 'none',
      message: `解压失败：${(e && e.message) || e}；tar 那边说：${(tarTry.stderr || '').slice(0, 200)}`,
    }
  }
}

/** 纯 JS 解 zip：走本地文件头，deflate 的用 inflateRaw，stored 的直接抄。 */
function unzipJs(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath)
  const base = path.resolve(destDir)
  let i = 0
  let guard = 0
  while (i < buf.length - 4 && guard++ < 200000) {
    if (buf.readUInt32LE(i) !== 0x04034b50) {
      i++
      continue
    }
    const method = buf.readUInt16LE(i + 8)
    let compSize = buf.readUInt32LE(i + 18)
    const uncompSize = buf.readUInt32LE(i + 22)
    const nameLen = buf.readUInt16LE(i + 26)
    const extraLen = buf.readUInt16LE(i + 28)
    const name = buf.slice(i + 30, i + 30 + nameLen).toString('utf8')
    const dataStart = i + 30 + nameLen + extraLen
    // 0xFFFFFFFF 表示真实长度在中央目录里，这里近似：取到文件尾，inflate 自己会停。
    if (compSize === 0xffffffff || uncompSize === 0xffffffff) compSize = buf.length - dataStart
    if (!name) {
      i++
      continue
    }
    const raw = buf.slice(dataStart, dataStart + compSize)
    const out = path.resolve(base, name)
    if (!out.startsWith(base)) throw new Error(`zip 里有越界路径：${name}`)
    if (name.endsWith('/')) {
      mkdirp(out)
    } else {
      mkdirp(path.dirname(out))
      if (method === 0) fs.writeFileSync(out, raw)
      else if (method === 8) fs.writeFileSync(out, zlib.inflateRawSync(raw))
      else throw new Error(`不支持的压缩方式 ${method}：${name}`)
    }
    i = dataStart + compSize
  }
}

//#endregion

//#region go-ios

/** 在若干目录里找 ios.exe，不下载。 */
export function locateIos({ runtimeDir, pluginRoot }) {
  const name = IS_WIN ? 'ios.exe' : 'ios'
  const cands = [
    path.join(runtimeDir, 'bin', name),
    path.join(pluginRoot, 'bin', name),
    process.env.DSH_IOS_PATH || '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'SideTap', 'bin', 'ios.exe') : '',
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'ios.exe') : '',
  ]
  for (const c of cands) {
    if (c && exists(c)) return c
  }
  return ''
}

/** 真跑一次 `ios version`，能出东西才算真的能用 —— 文件在但跑不起来的情况很常见。 */
export function verifyIos(iosPath) {
  const r = spawnSync(iosPath, ['version'], { encoding: 'utf8', timeout: 25000, windowsHide: true })
  if (r.error) return { ok: false, message: `跑不起来：${r.error.message}` }
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim()
  if (r.status !== 0 && !out) return { ok: false, message: `退出码 ${r.status}，没有输出` }
  if (/not recognized|不是内部或外部命令|Permission denied|拒绝访问/i.test(out)) {
    return { ok: false, message: out.slice(0, 200) }
  }
  return { ok: true, version: (out.split(/\r?\n/)[0] || '').slice(0, 120) }
}

/**
 * 确保有可用的 ios.exe。优先用现成的；没有才下。
 * @returns {Promise<{ok:boolean, path?:string, version?:string, downloaded?:boolean, message?:string}>}
 */
export async function ensureIos({ runtimeDir, pluginRoot, allowDownload = true, onProgress }) {
  const found = locateIos({ runtimeDir, pluginRoot })
  if (found) {
    const v = verifyIos(found)
    if (v.ok) return { ok: true, path: found, version: v.version, downloaded: false }
    // 文件在但坏了：在 .runtime 里的删掉重下；在别处别动人家的东西。
    if (found.startsWith(runtimeDir)) {
      try {
        fs.rmSync(found, { force: true })
      } catch {}
    } else {
      return {
        ok: false,
        message: `找到了 ${found}，但它跑不起来（${v.message}）。删掉它让插件自己下，或在 config.json 里改 iosPath。`,
      }
    }
  }

  const binDir = path.join(runtimeDir, 'bin')
  if (!allowDownload) {
    return {
      ok: false,
      message: `没找到 go-ios（ios.exe），且配置里关了自动下载。手动把 ios.exe 放到 ${binDir} 就行。`,
    }
  }

  const zipPath = path.join(runtimeDir, 'go-ios-win.zip')
  mkdirp(binDir)

  let buf = null
  const failures = []
  for (const src of GO_IOS_SOURCES) {
    try {
      let lastTick = 0
      buf = await httpGet(src, {
        onProgress: (got, total) => {
          const now = Date.now()
          if (now - lastTick < 300 && got !== total) return
          lastTick = now
          if (onProgress) onProgress(got, total || GO_IOS_ZIP_BYTES, src)
        },
      })
      if (buf.length < 1_000_000) {
        failures.push(`${src} → 只给了 ${buf.length} 字节`)
        buf = null
        continue
      }
      break
    } catch (e) {
      failures.push(`${src} → ${e.message}`)
      buf = null
    }
  }

  if (!buf) {
    return {
      ok: false,
      message:
        `三个源都没下来（直连 + ghfast.top + gh-proxy.com）。挨个说：${failures.join('；')}。` +
        `手动把这一个文件放进 ${binDir} 也一样能用（重命名成 ios.exe）：${GO_IOS_URL}`,
    }
  }

  fs.writeFileSync(zipPath, buf)
  const un = unzip(zipPath, binDir)
  if (!un.ok) return { ok: false, message: un.message }
  try {
    fs.rmSync(zipPath, { force: true })
  } catch {}

  const target = path.join(binDir, IS_WIN ? 'ios.exe' : 'ios')
  if (!exists(target)) {
    const hit = fs
      .readdirSync(binDir, { withFileTypes: true })
      .find((d) => d.isFile() && /^ios(\.exe)?$/.test(d.name))
    if (!hit) {
      return { ok: false, message: `解压完了但没看到 ios.exe，目录里是：${fs.readdirSync(binDir).join('、')}` }
    }
  }

  const v = verifyIos(target)
  if (!v.ok) return { ok: false, message: `下载完成但跑不起来：${v.message}（来源 ${GO_IOS_URL}，${buf.length} 字节）` }
  return { ok: true, path: target, version: v.version, downloaded: true }
}

//#endregion

//#region 命令小工具

/**
 * 同步跑命令，吞掉编码噪音。
 * Windows 上 go-ios 偶尔吐 GBK 字节，用 encoding:'utf8' 会抛解码错，
 * 所以按 buffer 收回来自己转，反正后面只做正则。
 */
function runQuiet(exe, args, opts = {}) {
  const r = spawnSync(exe, args, {
    encoding: 'buffer',
    timeout: opts.timeoutMs || 120000,
    windowsHide: true,
    env: opts.env || process.env,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  })
  const out = Buffer.concat([r.stdout || Buffer.alloc(0), r.stderr || Buffer.alloc(0)]).toString('utf8')
  return { ok: r.status === 0, status: r.status, out, error: r.error }
}

//#endregion

//#region 开发者镜像（DDI）

/**
 * 确保开发者镜像挂了。
 * 顺序：先问有没有挂 → 没有就让它自己下并挂 → 撞上证书错误就改 pymobiledevice3。
 *
 * 为什么要分两条路：go-ios 挂 DDI 时要向 gs.apple.com 拿签名，
 * 用的是 Go 自己的根证书库。Windows 上缺 Apple 根就报
 * `x509: certificate signed by unknown authority`，而 Go 不认 Windows 证书库。
 * pymobiledevice3 走 Python requests，能吃到 SSL_CERT_FILE 和系统库，是可靠的兜底。
 */
export function ensureDdi({ iosPath, python, venvDir, onStep }) {
  // 注意：`ios image list` 的退出码是 1，输出里也只有一个 signature 行，
  // 拿它判断「挂没挂」不可靠。下面一律看 `image auto` 自己说了什么。
  const basedir = path.join(path.dirname(venvDir), 'devimages')
  mkdirp(basedir)

  const listed = runQuiet(iosPath, ['image', 'list'], { timeoutMs: 30000, cwd: basedir })
  if (/mounted/i.test(listed.out) && !/not mounted|no image/i.test(listed.out)) {
    return { ok: true, how: 'already', message: '镜像已经是挂着的' }
  }

  if (onStep) onStep('正在挂开发者镜像')
  const autoArgs = ['image', 'auto', `--basedir=${basedir}`]
  const auto = runQuiet(iosPath, autoArgs, { timeoutMs: 300000, cwd: basedir })
  if (auto.ok && /success mounting image|already a developer image mounted/i.test(auto.out)) {
    return { ok: true, how: 'go-ios', message: '用 go-ios 挂上了' }
  }
  if (auto.ok && !/failed|error|x509/i.test(auto.out)) {
    return { ok: true, how: 'go-ios', message: '用 go-ios 挂上了' }
  }

  const certIssue = /x509|certificate signed by unknown authority|tls:/i.test(auto.out)
  const firstError =
    auto.out
      .trim()
      .split(/\r?\n/)
      .filter((l) => /error|failed|x509/i.test(l))
      .slice(-1)[0] || auto.out.slice(-300)

  if (!certIssue) {
    // 不是证书问题，再给 go-ios 一次机会：它有时第一次只是没连上手机
    const retry = runQuiet(iosPath, autoArgs, { timeoutMs: 300000, cwd: basedir })
    if (retry.ok && !/failed|error/i.test(retry.out)) return { ok: true, how: 'go-ios-retry', message: '第二次挂上了' }
    return {
      ok: false,
      how: 'none',
      message: `挂开发者镜像失败（不是证书问题）：${firstError}`,
      raw: auto.out.slice(-2000),
    }
  }

  // 证书问题：转 pymobiledevice3
  if (!python) {
    return {
      ok: false,
      how: 'none',
      certIssue: true,
      message:
        '这台机器的系统证书库里没有 Apple 根证书，go-ios 因此没法向苹果要签名。' +
        '装个 Python 3（安装时勾 Add to PATH）再点连接，插件会自己换另一条路挂镜像。',
    }
  }

  if (onStep) onStep('go-ios 撞上证书问题，改用 pymobiledevice3')
  const py = ensurePmd3({ python, venvDir, onStep })
  if (!py.ok) return { ok: false, how: 'none', certIssue: true, message: py.message }

  // pymobiledevice3 把状态写在家目录，家目录建不了就炸，先挪到 .runtime
  const home = path.join(venvDir, 'home')
  mkdirp(home)
  const env = { ...process.env, HOME: home, USERPROFILE: home }
  const mount = runQuiet(py.python, ['-m', 'pymobiledevice3', 'mounter', 'auto-mount'], { timeoutMs: 300000, env })
  if (/mounted successfully|DeveloperDiskImage mounted/i.test(mount.out)) {
    return { ok: true, how: 'pymobiledevice3', message: '改用 pymobiledevice3 挂上了' }
  }
  return {
    ok: false,
    how: 'none',
    certIssue: true,
    message: `两条路都没挂上。go-ios 说：${firstError}；pymobiledevice3 说：${mount.out.trim().slice(-500)}`,
    raw: mount.out.slice(-2000),
  }
}

//#endregion

//#region pymobiledevice3

/**
 * 按需建 venv 装 pymobiledevice3。
 * 只有真撞上证书问题才会走到这里 —— 正常机器一辈子用不上，不该让它拖慢启动。
 */
export function ensurePmd3({ python, venvDir, onStep }) {
  const pyDir = path.join(venvDir, 'venv')
  const pyExe = path.join(pyDir, IS_WIN ? 'Scripts' : 'bin', IS_WIN ? 'python.exe' : 'python')
  const marker = path.join(pyDir, '.pmd3-ok')

  if (exists(pyExe) && exists(marker)) {
    const probe = runQuiet(pyExe, ['-m', 'pymobiledevice3', 'version'], { timeoutMs: 30000 })
    if (probe.ok) return { ok: true, python: pyExe, cached: true }
  }

  mkdirp(venvDir)
  if (onStep) onStep('正在准备 Python 环境（第一次要等两分钟）')

  const mk = runQuiet(python, ['-m', 'venv', pyDir], { timeoutMs: 180000 })
  if (!exists(pyExe)) {
    return { ok: false, message: `建 Python 虚拟环境失败：${mk.out.trim().slice(-400) || '没生成 ' + pyExe}` }
  }

  const ins = runQuiet(pyExe, ['-m', 'pip', 'install', '--disable-pip-version-check', '-i', PYPI_INDEX, PY_PACKAGE], {
    timeoutMs: 600000,
  })
  const probe = runQuiet(pyExe, ['-m', 'pymobiledevice3', 'version'], { timeoutMs: 30000 })
  if (!probe.ok) {
    return { ok: false, message: `装 ${PY_PACKAGE} 失败：${ins.out.trim().slice(-600) || '没有输出'}` }
  }
  try {
    fs.writeFileSync(marker, new Date().toISOString(), 'utf8')
  } catch {}
  return { ok: true, python: pyExe, cached: false }
}

//#endregion
