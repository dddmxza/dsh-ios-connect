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
  color:var(--dsw-alias-label-secondary, inherit); }
.dic-empty code { font-size:11.5px; padding:1px 5px; border-radius:4px;
  background:var(--dsw-alias-fill-l2, rgba(128,128,128,.15)); }
.dic-prog { height:3px; border-radius:2px; margin:0 12px 6px; overflow:hidden; flex:none;
  background:var(--dsw-alias-fill-l2, rgba(128,128,128,.15)); }
.dic-prog span { display:block; height:100%; background:var(--dsw-alias-brand-primary, #4a7dff);
  transition:width .3s ease; }
.dic-set { padding:2px 0; }
.dic-set-row { display:flex; align-items:center; gap:8px; margin-top:8px; flex-wrap:wrap; }
.dic-set-input { flex:1; min-width:140px; font-size:12.5px; padding:5px 9px; border-radius:6px;
  color:inherit; background:var(--dsw-alias-fill-l1, rgba(128,128,128,.1));
  border:1px solid var(--dsw-alias-border-l1, rgba(128,128,128,.35)); outline:none; }
.dic-set-input:focus { border-color:var(--dsw-alias-brand-primary, #4a7dff); }
.dic-set-note { font-size:11.5px; line-height:1.6; margin-top:6px;
  color:var(--dsw-alias-label-tertiary, inherit); }
.dic-set-ok { color:#2f9e6a; }
.dic-set-bad { color:var(--dsw-alias-state-error-primary, #d1463c); }
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
            : h('div', { className: 'dic-empty' }, [
                h('div', { key: '1' }, st.phase === 'error' ? st.message : '手机画面会显示在这里。'),
                st.phase === 'error'
                  ? h('div', { key: '2', style: { marginTop: '10px', opacity: '.8', fontSize: '11.5px' } },
                      '硬件先确认：线插着、手机解锁、点过「信任此电脑」。')
                  : null,
                ...missing,
              ]),
        ),
      ])
    }

    /**
     * 插件设置页里的那张卡片：只干一件事 —— 收锁屏密码。
     * 密码只往 .env 写，接口从不回传它，所以这里永远拿不到原值，只能显示「已设置」。
     */
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

      const save = useCallback(
        async (value) => {
          setBusy(true)
          setMsg('')
          try {
            const r = await call('.config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ passcode: value }),
            })
            setHas(!!r.hasPasscode)
            setPw('')
            setMsg(value ? '已保存。' : '已清除。')
          } catch (e) {
            setMsg('没存上：' + (e.message || e))
          } finally {
            setBusy(false)
          }
        },
        [],
      )

      return h('div', { className: 'dic-set' }, [
        h('div', { key: 't', style: { fontSize: '13px', fontWeight: '600' } }, '锁屏密码'),
        h(
          'div',
          { key: 'd', className: 'dic-set-note', style: { marginTop: '4px' } },
          '手机有锁屏密码的话填上，智能体才能替你解锁、点开 App。没填就只点亮屏幕上滑。',
        ),
        h('div', { key: 'r', className: 'dic-set-row' }, [
          h('input', {
            key: 'i',
            className: 'dic-set-input',
            type: 'password',
            inputMode: 'numeric',
            autoComplete: 'off',
            placeholder: has ? '已设置，填新的可覆盖' : '在这里输入密码',
            value: pw,
            disabled: busy,
            onChange: (e) => setPw(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && pw.trim()) save(pw.trim())
            },
          }),
          h(
            'button',
            {
              key: 'b',
              className: 'dic-btn',
              disabled: busy || !pw.trim(),
              onClick: () => save(pw.trim()),
            },
            busy ? '保存中' : '保存',
          ),
          has
            ? h(
                'button',
                { key: 'c', className: 'dic-btn', disabled: busy, onClick: () => save('') },
                '清除',
              )
            : null,
        ]),
        h(
          'div',
          { key: 'n', className: 'dic-set-note' },
          h('span', { className: has ? 'dic-set-ok' : '' }, has ? '当前：已设置' : '当前：未设置'),
          h('span', { key: 'p' }, '　密码存在用户目录下的 .env，不进仓库、不随升级丢。'),
        ),
        msg ? h('div', { key: 'm', className: 'dic-set-note dic-set-ok' }, msg) : null,
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
