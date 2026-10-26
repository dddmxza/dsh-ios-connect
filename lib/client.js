/**
 * dsh-ios-connect — 浏览器半边。
 *
 * 只做一件事：在右边栏挂一个「iPhone」标签，里面是实时画面。
 * 画面走宿主代理的 /api/dsh-ios-connect.stream（同源 MJPEG），
 * 用 <img> 吃流，所以点画面不会传到手机上 —— 这里只看不动手。
 *
 * 打包形式是宿主 __ModuleLoader__ 的约定：一个自执行函数，返回 { apply, inject }。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ios-connect',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    const API = '/api/dsh-ios-connect'
    const KIND = 'ios-phone'
    const NS = 'dsh-ios-connect'

    function injectStyles() {
      if (document.getElementById('dic-style')) return
      const tag = document.createElement('style')
      tag.id = 'dic-style'
      tag.textContent = `
.dic-wrap { display:flex; flex-direction:column; height:100%; min-height:0;
  background:var(--dsw-alias-bg-base, transparent); color:inherit; }
.dic-bar { display:flex; align-items:center; gap:8px; padding:8px 12px; flex:none;
  border-bottom:1px solid var(--dsw-alias-separator-primary, rgba(128,128,128,.22)); }
.dic-dot { width:8px; height:8px; border-radius:50%; background:var(--dsw-alias-label-tertiary, #8b949e); opacity:.6; flex:none; }
.dic-dot-ready { background:#2f9e6a; opacity:1; box-shadow:0 0 6px rgba(47,158,106,.8); }
.dic-dot-busy { background:#d29922; opacity:1; animation:dicPulse 1.2s ease-in-out infinite; }
.dic-dot-err { background:var(--dsw-alias-state-error-primary, #d1463c); opacity:1; }
@keyframes dicPulse { 0%,100%{opacity:1} 50%{opacity:.35} }
.dic-text { font-size:12px; line-height:1.4; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  color:var(--dsw-alias-label-secondary, inherit); }
.dic-btn { font-size:12px; padding:4px 10px; border-radius:6px; cursor:pointer; color:inherit; flex:none;
  border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35)); background:transparent; opacity:.85; }
.dic-btn:hover { opacity:1; background:var(--dsw-alias-fill-l1, rgba(128,128,128,.12)); }
.dic-btn:disabled { opacity:.4; cursor:default; }
.dic-body { flex:1; min-height:0; display:flex; align-items:center; justify-content:center; overflow:hidden; padding:8px;
  background:var(--dsw-alias-bg-base, transparent); }
.dic-screen { max-width:100%; max-height:100%; object-fit:contain; border-radius:10px; display:block;
  box-shadow:0 0 0 1px var(--dsw-alias-border-l1, rgba(128,128,128,.2)); }
.dic-empty { font-size:12.5px; line-height:1.8; text-align:center; padding:24px; max-width:320px;
  color:var(--dsw-alias-label-secondary, inherit); overflow-wrap:anywhere; white-space:pre-wrap; }
/* 出错时是给人照着做的字，左对齐比居中好读，也才放得下那条路径。 */
.dic-empty-err { text-align:left; font-size:12px; line-height:1.75; }
.dic-empty code { font-size:11.5px; padding:1px 5px; border-radius:4px;
  background:var(--dsw-alias-fill-l2, rgba(128,128,128,.15)); }
.dic-prog { height:3px; border-radius:2px; margin:0 12px 6px; overflow:hidden; flex:none;
  background:var(--dsw-alias-fill-l2, rgba(128,128,128,.15)); }
.dic-prog span { display:block; height:100%; background:var(--dsw-alias-brand-primary, #4a7dff);
  transition:width .3s ease; }
/* 设置卡片。标题行右侧那个小圆点是状态：绿=已设置，灰=未设置。 */
.dic-card { border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.28));
  border-radius:12px; background:var(--dsw-alias-bg-l1, rgba(128,128,128,.05));
  padding:14px 16px 15px; }
.dic-card-head { display:flex; align-items:center; gap:8px; }
.dic-card-title { font-size:13px; font-weight:600; letter-spacing:.01em;
  color:var(--dsw-alias-label-primary, inherit); }
.dic-pill { display:inline-flex; align-items:center; gap:5px; padding:2px 8px; border-radius:999px;
  font-size:11px; line-height:1.5; flex:none;
  border:1px solid var(--dsw-alias-border-l2, rgba(128,128,128,.3));
  color:var(--dsw-alias-label-tertiary, inherit); }
.dic-pill-dot { width:5px; height:5px; border-radius:50%; background:currentColor; opacity:.5; flex:none; }
.dic-pill-on { color:var(--dsw-alias-state-success-primary, #2f9e6a);
  border-color:currentColor; }
.dic-pill-on .dic-pill-dot { opacity:1; }
.dic-card-desc { font-size:12px; line-height:1.65; margin-top:7px;
  color:var(--dsw-alias-label-secondary, inherit); }
.dic-card-row { display:flex; align-items:center; gap:8px; margin-top:12px; }
.dic-warn { margin-top:10px; padding:9px 11px; border-radius:8px; font-size:11.5px; line-height:1.7;
  background:rgba(196,140,20,.10);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary, #c48c14) 11%, transparent);
  border-left:3px solid var(--dsw-alias-state-warn-primary, #c48c14);
  color:var(--dsw-alias-label-secondary, inherit); }
.dic-warn b { font-weight:600; color:var(--dsw-alias-state-warn-primary, #c48c14); }
.dic-count { font-size:11px; margin-top:6px; color:var(--dsw-alias-label-tertiary, inherit); }
.dic-count-bad { color:var(--dsw-alias-state-warn-primary, #c48c14); }
.dic-input { flex:1; min-width:0; box-sizing:border-box; height:34px; padding:0 11px;
  font-size:13px; font-family:inherit; border-radius:8px; color:inherit; outline:none;
  background:var(--dsw-alias-fill-l1, rgba(128,128,128,.08));
  border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3));
  transition:border-color .15s ease, background .15s ease; }
.dic-input::placeholder { color:var(--dsw-alias-label-quaternary, rgba(128,128,128,.75)); }
.dic-input:hover { border-color:var(--dsw-alias-border-l3, rgba(128,128,128,.45)); }
.dic-input:focus { border-color:var(--dsw-alias-brand-primary, #4a7cf0);
  background:var(--dsw-alias-bg-base, transparent); }
.dic-input:disabled { opacity:.55; }
.dic-act { flex:none; height:34px; padding:0 16px; border-radius:8px; font-size:13px; cursor:pointer;
  font-family:inherit; border:1px solid transparent; transition:opacity .15s ease, background .15s ease; }
.dic-act-primary { background:var(--dsw-alias-brand-primary, #4a7cf0); color:#fff; }
.dic-act-primary:hover:not(:disabled) { opacity:.88; }
.dic-act-ghost { background:transparent; color:currentColor;
  border-color:var(--dsw-alias-border-l2, rgba(128,128,128,.3)); }
.dic-act-ghost:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,.1)); }
.dic-act:disabled { cursor:default; }
/* 禁用态不能整体降透明度：白字乘 .38 之后和同样被打薄的蓝底一个亮度，
   字就跟底糊成一块，看着像按钮上没字（2026-10-26 用户就是这么撞上的）。 */
.dic-act-primary:disabled { background:var(--dsw-alias-fill-l2, rgba(128,128,128,.22));
  color:var(--dsw-alias-label-tertiary, rgba(160,160,160,.95)); }
.dic-act-ghost:disabled { opacity:.45; }
.dic-card-foot { display:flex; align-items:center; gap:6px; margin-top:11px;
  font-size:11.5px; line-height:1.6; color:var(--dsw-alias-label-tertiary, inherit); }
.dic-card-foot code { font-size:11px; padding:1px 5px; border-radius:4px;
  background:var(--dsw-alias-fill-l2, rgba(128,128,128,.14)); }
.dic-msg { font-size:11.5px; margin-top:8px; }
.dic-msg-ok { color:var(--dsw-alias-state-success-primary, #2f9e6a); }
.dic-msg-bad { color:var(--dsw-alias-state-error-primary, #d1463c); }
/* 环境检查清单。五行，缺哪行哪行变红、给一行字说现在该干什么。 */
.dic-check { margin-bottom:14px; }
.dic-check-head { display:flex; align-items:center; gap:8px; }
.dic-check-head .dic-pill { flex:none; }
.dic-check-refresh { margin-left:auto; flex:none; font-family:inherit; font-size:11px;
  padding:3px 9px; border-radius:6px; cursor:pointer;
  color:var(--dsw-alias-label-tertiary, inherit); background:transparent;
  border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.3)); }
.dic-check-refresh:hover:not(:disabled) { background:var(--dsw-alias-fill-l1, rgba(128,128,128,.1)); }
.dic-check-refresh:disabled { opacity:.45; cursor:default; }
.dic-rows { display:flex; flex-direction:column; margin-top:9px; }
.dic-row { display:flex; gap:9px; padding:8px 0; align-items:flex-start;
  border-top:1px solid var(--dsw-alias-separator-primary, rgba(128,128,128,.16)); }
.dic-row:first-child { border-top:none; padding-top:0; }
.dic-row-dot { width:6px; height:6px; border-radius:50%; margin-top:6px; flex:none;
  background:var(--dsw-alias-label-tertiary, #8b949e); opacity:.5; }
.dic-row-ok .dic-row-dot { background:var(--dsw-alias-state-success-primary, #2f9e6a); opacity:1; }
.dic-row-missing .dic-row-dot { background:var(--dsw-alias-state-error-primary, #d1463c); opacity:1; }
.dic-row-main { flex:1; min-width:0; }
.dic-row-title { font-size:12.5px; line-height:1.5; color:var(--dsw-alias-label-primary, inherit); }
.dic-row-ok .dic-row-title { color:var(--dsw-alias-label-secondary, inherit); }
.dic-row-missing .dic-row-title { font-weight:600; }
.dic-row-detail { font-size:11px; line-height:1.65; margin-top:2px; word-break:break-all;
  color:var(--dsw-alias-label-quaternary, inherit); }
.dic-row-hint { font-size:11.5px; line-height:1.75; margin-top:5px;
  color:var(--dsw-alias-label-secondary, inherit); }
.dic-row-act { margin-top:8px; }
`
      document.head.appendChild(tag)
    }

    async function call(path, init) {
      const r = await fetch(API + path, init)
      const text = await r.text()
      try {
        return JSON.parse(text)
      } catch {
        return { ok: false, message: text }
      }
    }

    function Panel() {
      const [st, setSt] = useState({ phase: 'idle', message: '还没启动' })
      const [busy, setBusy] = useState(false)
      const [autoTrying, setAutoTrying] = useState(false)
      const [tick, setTick] = useState(0)
      const timer = useRef(null)

      const refresh = useCallback(async () => {
        try {
          const s = await call('.status')
          setSt(s)
          if (s.phase === 'ready' && timer.current === null) {
            timer.current = setInterval(() => setTick((v) => v + 1), 5000)
          }
          if (s.phase !== 'ready' && timer.current !== null) {
            clearInterval(timer.current)
            timer.current = null
          }
        } catch (e) {
          setSt({ phase: 'error', message: String(e.message || e) })
        }
      }, [])

      useEffect(() => {
        refresh()
        const id = setInterval(refresh, 4000)
        return () => {
          clearInterval(id)
          if (timer.current !== null) clearInterval(timer.current)
        }
      }, [refresh])
      const onStart = useCallback(async () => {
        setBusy(true)
        try {
          const r = await call('.start', { method: 'POST' })
          setSt((prev) => ({ ...prev, phase: r.ok ? 'ready' : 'error', message: r.message || prev.message }))
        } finally {
          setBusy(false)
          refresh()
        }
      }, [refresh])

      const onStop = useCallback(async () => {
        setBusy(true)
        try {
          await call('.stop', { method: 'POST' })
        } finally {
          setBusy(false)
          refresh()
        }
      }, [refresh])

      /**
       * 点开这个标签页就自己试一次连接。
       *
       * 为什么能这么做：面板是点标签页时才挂载的，不点这个标签页就根本不会渲染，
       * 也就不会发这个请求 —— 所以「只开侧栏不点 iPhone」不会白起链路。
       *
       * 只试一次：`tried` 挡着，别让下面那个 4 秒的轮询把它变成反复重启。
       * 失败也不重试 —— startChain 里已经有 30 秒防抖的重连，两层重试会互相打架。
       */
      const tried = useRef(false)
      useEffect(() => {
        if (tried.current) return
        tried.current = true
        ;(async () => {
          try {
            const s = await call('.status')
            // 已经在跑（比如上一次点开时连上的）就别再踢一脚
            if (s && s.phase === 'ready') return
            setBusy(true)
            setAutoTrying(true)
            const r = await call('.start', { method: 'POST' })
            setSt((prev) => ({ ...prev, phase: r.ok ? 'ready' : 'error', message: r.message || prev.message }))
          } catch (e) {
            setSt({ phase: 'error', message: '连不上插件服务：' + String((e && e.message) || e) })
          } finally {
            setAutoTrying(false)
            setBusy(false)
            refresh()
          }
        })()
      }, [refresh])

      // 签名工具不在就替用户下安装包 —— 只下不装，装要 UAC，得他自己双击。
      const [signerBusy, setSignerBusy] = useState(false)
      const onGetSigner = useCallback(async () => {
        setSignerBusy(true)
        try {
          const r = await call('.signer', { method: 'POST' })
          setSt((prev) => ({ ...prev, message: r.message || prev.message }))
        } finally {
          setSignerBusy(false)
          refresh()
        }
      }, [refresh])

      const ready = st.phase === 'ready'
      const dot = busy || st.phase === 'starting' ? 'dic-dot dic-dot-busy'
        : ready ? 'dic-dot dic-dot-ready'
        : st.phase === 'error' ? 'dic-dot dic-dot-err'
        : 'dic-dot'

      const deps = st.deps || {}
      const signer = st.signer || {}
      const showProgress =
        (busy || st.phase === 'starting' || signerBusy) &&
        (deps.stage === 'download' || deps.stage === 'signer') &&
        deps.percent > 0

      // 没通的时候，把「还差什么」摆出来：签名工具在不在、ipa 在不在。
      const missing = []
      if (!ready) {
        if (!signer.installed) {
          missing.push(
            h('div', { key: 'm1', style: { marginTop: '12px' } }, [
              h('div', { key: 'a' }, '① 签名工具还没装 —— 用它在手机上装控制器，要用你的 Apple ID。'),
              h(
                'button',
                { className: 'dic-btn', key: 'b', style: { marginTop: '6px' }, onClick: onGetSigner, disabled: signerBusy },
                signerBusy ? '下载中' : '下载 iloader 安装包',
              ),
              h('div', { key: 'c', style: { marginTop: '6px', opacity: '.7', fontSize: '11.5px' } },
                '下到「下载」文件夹，双击安装，装完回来点连接。'),
            ]),
          )
        } else {
          missing.push(
            h('div', { key: 'm2', style: { marginTop: '12px' } }, [
              h('div', { key: 'a' }, `① 签名工具 ${signer.name} 已就位。`),
              signer.ipaReady
                ? h('div', { key: 'b', style: { fontSize: '11.5px', opacity: '.8', wordBreak: 'break-all' } },
                    `要装进手机的文件：${signer.ipa}`)
                : h('div', { key: 'b', style: { fontSize: '11.5px' }, }, '但安装包里没有 ipa —— 包不完整，重装插件。'),
            ]),
          )
        }
        missing.push(
          h('div', { key: 'm3', style: { marginTop: '10px' } },
            '② 装完去 设置→通用→VPN与设备管理 点信任。③ 回来点连接。'),
        )
      }

      return h('div', { className: 'dic-wrap' }, [
        h('div', { className: 'dic-bar', key: 'bar' }, [
          h('span', { className: dot, key: 'd' }),
          h('span', { className: 'dic-text', key: 't', title: st.message }, st.message || st.phase),
          ready
            ? h('button', { className: 'dic-btn', key: 's', onClick: onStop, disabled: busy }, '断开')
            : h('button', { className: 'dic-btn', key: 's', onClick: onStart, disabled: busy }, busy ? '连接中' : '连接'),
        ]),
        showProgress
          ? h('div', { className: 'dic-prog', key: 'p' }, h('span', { style: { width: `${deps.percent}%` } }))
          : null,
        h(
          'div',
          { className: 'dic-body', key: 'b' },
          ready
            ? h('img', {
                className: 'dic-screen',
                src: `${API}.stream?t=${tick}`,
                alt: 'iPhone 画面',
                draggable: false,
                style: { pointerEvents: 'none', userSelect: 'none' },
              })
            : h('div', { className: 'dic-empty' + (st.phase === 'error' ? ' dic-empty-err' : '') }, [
                h(
                  'div',
                  { key: '1' },
                  autoTrying
                    ? '正在找手机…'
                    : st.phase === 'error'
                      ? st.message
                      : '手机画面会显示在这里。',
                ),
                ...(autoTrying ? [] : missing),
              ]),
        ),
      ])
    }

    /**
     * 插件设置页里的那张卡片：只干一件事 —— 收锁屏密码。
     * 密码只往 .env 写，接口从不回传它，所以这里永远拿不到原值，只能显示「已设置」。
     */
    /**
     * 环境检查清单。用户装了插件之后，唯一的界面就是这张卡片 ——
     * README 别指望他会去看，尤其上不去 GitHub 的时候。
     * 所以这里一次只指一件事：缺哪样，那行变红，底下说清现在该干什么。
     */
    function CheckRow({ it, onSigner }) {
      const cls =
        'dic-row ' +
        (it.state === 'ok' ? 'dic-row-ok' : it.state === 'missing' ? 'dic-row-missing' : 'dic-row-unknown')
      return h('div', { className: cls }, [
        h('span', { key: 'd', className: 'dic-row-dot' }),
        h('div', { key: 'm', className: 'dic-row-main' }, [
          h('div', { key: 't', className: 'dic-row-title' }, it.title),
          it.detail ? h('div', { key: 'x', className: 'dic-row-detail' }, it.detail) : null,
          it.hint ? h('div', { key: 'h', className: 'dic-row-hint' }, it.hint) : null,
          it.action && it.action.kind === 'signer'
            ? h(
                'div',
                { key: 'a', className: 'dic-row-act' },
                h(
                  'button',
                  { className: 'dic-act dic-act-primary', onClick: onSigner },
                  '下载 iloader 安装包',
                ),
              )
            : null,
        ]),
      ])
    }

    function CheckList() {
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState(false)
      const [signerBusy, setSignerBusy] = useState(false)
      const [err, setErr] = useState('')

      const run = useCallback(async () => {
        setBusy(true)
        setErr('')
        try {
          setData(await call('.check'))
        } catch (e) {
          setErr('查不了：' + (e.message || e))
        } finally {
          setBusy(false)
        }
      }, [])

      useEffect(() => {
        run()
      }, [run])

      const onSigner = useCallback(async () => {
        setSignerBusy(true)
        try {
          await call('.signer', { method: 'POST' })
        } finally {
          setSignerBusy(false)
          run()
        }
      }, [run])

      const items = (data && data.items) || []
      const ready = !!(data && data.ok)
      const left = data && data.missing ? data.missing.length : 0
      const wait = data && data.unknown ? data.unknown.length : 0
      const label = !data
        ? busy
          ? '检查中'
          : '还没查'
        : ready
          ? wait
            ? `齐了，${wait} 项待确认`
            : '全都齐了'
          : `还差 ${left} 样`

      return h('div', { className: 'dic-card dic-check' }, [
        h('div', { key: 'h', className: 'dic-check-head' }, [
          h('div', { key: 't', className: 'dic-card-title' }, '环境检查'),
          h('span', { key: 'p', className: 'dic-pill' + (ready ? ' dic-pill-on' : '') }, [
            h('span', { key: 'd', className: 'dic-pill-dot' }),
            label,
          ]),
          h(
            'button',
            { key: 'r', className: 'dic-check-refresh', disabled: busy, onClick: run },
            busy ? '查…' : '重查',
          ),
        ]),
        h(
          'div',
          { key: 'd', className: 'dic-card-desc' },
          '连不上手机时从上往下补。每一行只说现在该做的那一件事。',
        ),
        h('div', { key: 'l', className: 'dic-rows' }, items.map((it) => h(CheckRow, { key: it.id, it, onSigner }))),
        err ? h('div', { key: 'e', className: 'dic-msg dic-msg-bad' }, err) : null,
      ])
    }

    function SettingsCard() {
      const [has, setHas] = useState(false)
      const [pw, setPw] = useState('')
      const [busy, setBusy] = useState(false)
      const [msg, setMsg] = useState('')

      const load = useCallback(async () => {
        try {
          const c = await call('.config')
          setHas(!!c.hasPasscode)
        } catch {}
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const [saved, setSaved] = useState(null) // null | 'ok' | 'bad'
      const [confirming, setConfirming] = useState(false)

      const save = useCallback(async (value) => {
        setBusy(true)
        setSaved(null)
        try {
          const r = await call('.config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passcode: value }),
          })
          setHas(!!r.hasPasscode)
          setPw('')
          setSaved('ok')
        } catch (e) {
          setMsg('没存上：' + (e.message || e))
          setSaved('bad')
        } finally {
          setBusy(false)
        }
      }, [])

      // 按「保存」不直接存，先停一步让人再核一遍 —— 存错密码的代价是手机上
      // 的失败次数，不是重填一次那么简单。
      const confirmHint = confirming
        ? h(
            'div',
            { key: 'cf', className: 'dic-count dic-count-bad' },
            `再核一遍：手机锁屏上输的就是这 ${pw.length} 位吗？确认之后才写进去。`,
          )
        : null

      return h('div', null, [
        h(CheckList, { key: 'chk' }),
        h('div', { key: 'card', className: 'dic-card' }, [
        h('div', { key: 'h', className: 'dic-card-head' }, [
          h('div', { key: 't', className: 'dic-card-title' }, '锁屏密码'),
          h(
            'span',
            { key: 's', className: 'dic-pill' + (has ? ' dic-pill-on' : '') },
            [h('span', { key: 'd', className: 'dic-pill-dot' }), has ? '已设置' : '未设置'],
          ),
        ]),
        h(
          'div',
          { key: 'd', className: 'dic-card-desc' },
          '手机有锁屏密码就填上，智能体才能替你解锁、点开 App。没填只点亮屏幕上滑。',
        ),
        h('div', { key: 'w', className: 'dic-warn' }, [
          h('b', { key: 'b' }, '填之前先在手机上解锁一遍，确认一位不差。'),
          h(
            'span',
            { key: 's' },
            '密码输错会计进手机的失败次数：错 5 次锁 1 分钟，往上依次 5 分钟、15 分钟、1 小时；开了「抹掉数据」的手机，错到第 10 次会被抹掉。插件不会自动重试，但填错一次就是错一次。',
          ),
        ]),
        h('div', { key: 'r', className: 'dic-card-row' }, [
          h('input', {
            key: 'i',
            className: 'dic-input',
            type: 'password',
            inputMode: 'numeric',
            autoComplete: 'off',
            'aria-label': '锁屏密码',
            placeholder: has ? '已设置，输入新密码可覆盖' : '输入手机锁屏密码',
            value: pw,
            disabled: busy,
            onChange: (e) => {
              setPw(e.target.value)
              setSaved(null)
              setConfirming(false)
              setMsg('')
            },
            onKeyDown: (e) => {
              if (e.key === 'Enter' && pw.trim()) setConfirming(true)
            },
          }),
          confirming
            ? h(
                'button',
                {
                  key: 'ok',
                  className: 'dic-act dic-act-primary',
                  disabled: busy,
                  onClick: () => {
                    setConfirming(false)
                    save(pw.trim())
                  },
                },
                busy ? '保存中' : `确认 ${pw.length} 位`,
              )
            : h(
                'button',
                {
                  key: 'b',
                  className: 'dic-act dic-act-primary',
                  disabled: busy || !pw.trim(),
                  onClick: () => {
                    setConfirming(true)
                    setSaved(null)
                    setMsg('')
                  },
                },
                '保存',
              ),
          confirming
            ? h(
                'button',
                {
                  key: 'no',
                  className: 'dic-act dic-act-ghost',
                  disabled: busy,
                  onClick: () => setConfirming(false),
                },
                '再改改',
              )
            : has
              ? h(
                  'button',
                  {
                    key: 'c',
                    className: 'dic-act dic-act-ghost',
                    disabled: busy,
                    onClick: () => save(''),
                  },
                  '清除',
                )
              : null,
        ]),
        confirmHint,
        pw
          ? h(
              'div',
              {
                key: 'len',
                className: 'dic-count' + ([4, 6].includes(pw.length) ? '' : ' dic-count-bad'),
              },
              [4, 6].includes(pw.length)
                ? `已输入 ${pw.length} 位`
                : `已输入 ${pw.length} 位 —— 常见是 4 位或 6 位，对一下手机上是几位`,
            )
          : null,
        h('div', { key: 'f', className: 'dic-card-foot' }, [
          h('code', { key: 'p' }, '~/.dsh-ios-connect/.env'),
          h('span', { key: 'n' }, '不进仓库，不随插件升级丢。'),
        ]),
        msg
          ? h(
              'div',
              { key: 'm', className: 'dic-msg ' + (saved === 'bad' ? 'dic-msg-bad' : 'dic-msg-ok') },
              msg,
            )
          : null,
        ]),
      ])
    }

    function apply(ctx) {
      injectStyles()

      // 注册右侧栏面板类型。guide 里那条是「新标签页」列表里的卡片，
      // 点它等于 openTab(KIND)；body 由下面那个 slot 按 id 派发。
      // priority 留空 = extension 档，插件身份的正确档位。
      try {
        ctx.effect(
          () =>
            ctx.sidebarRightTabs.register({
              id: NS,
              kind: KIND,
              title: () => 'iPhone',
              guide: [
                {
                  id: 'open',
                  order: 15,
                  title: () => 'iPhone',
                  description: () => '手机实时画面',
                },
              ],
            }),
          'dsh-ios-connect: sidebar tab type',
        )
      } catch (e) {
        console.error('[dsh-ios-connect] 注册面板类型失败：', e)
      }

      try {
        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register({ name: 'sidebar.right.pane.tab', key: NS }, () => h(Panel)),
        )
      } catch (e) {
        console.error('[dsh-ios-connect] 挂面板失败：', e)
      }

      // 插件管理页里的设置卡片。宿主可能按「包名」或「include:包名」两种身份挂载，
      // 两种都注册，哪种命中都不至于整张卡片消失。
      try {
        ctx.slots.inject('plugins.bundle.config', () => {
          const out = []
          for (const key of [NS, 'include:' + NS]) {
            out.push(
              ctx.slots.register({ name: 'plugins.bundle.config', key }, () => h(SettingsCard)),
            )
          }
          return out
        })
      } catch (e) {
        console.error('[dsh-ios-connect] 挂设置卡片失败：', e)
      }
    }

    exports.apply = apply
    exports.inject = ['slots', 'sidebarRightTabs']
    return module.exports
  },
})
