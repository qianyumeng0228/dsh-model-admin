/**
 * dsh-model-admin — browser half.
 *
 * Registered as ONE settings section (「设置 → Model Admin」) through the
 * host's `settings.section` slot — the same seat `dsh-our-free-model` and
 * `dsh-router-core` use. That is what puts the page in the settings panel's
 * left navigation instead of burying it inside the plugins page.
 *
 * This file is a hand-written ModuleLoader bundle: no build step, no
 * dependency beyond the `react` the shell already provides. The host calls
 * `apply(ctx)` with the client context; `slots`, `locale` and `connection`
 * are injected services.
 *
 * Data is read over the plugin's own same-origin `/api/dsh-model-admin`
 * routes (served by the host half) rather than a typed Remote binding, so
 * one code path works on every kernel line this plugin targets.
 */

window.__ModuleLoader__.load({
  id: 'dsh-model-admin',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useState, useEffect, useCallback } = React

    // Resolve the API path relative to document.baseURI, not as a hardcoded
    // absolute path: DSH may serve the settings page under a sub-path, and a
    // leading slash would drop that prefix and hit the host gateway's 404.
    const API_PATH = (() => {
      try { return new URL('api/dsh-model-admin', document.baseURI).pathname } catch { return '/api/dsh-model-admin' }
    })()
    const DEFAULT_TIMEOUT_MS = 60_000
    const CLAIM_TIMEOUT_MS = 120_000

    // ── the API client ───────────────────────────────────────────────────────
    /**
     * Transport over the plugin's own console API. The connection service is
     * read per call (the host composes services asynchronously — a client
     * captured at import time would hold a stale reference), and every answer
     * is one envelope, so there is exactly one error path.
     */
    function createApiClient(getConnection) {
      async function call(method, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
        const connection = getConnection()
        if (connection === null) throw new Error('no-connection')
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
          const response = await fetch(API_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ method, payload }),
            signal: controller.signal,
          })
          const text = await response.text()
          let envelope
          try { envelope = text === '' ? {} : JSON.parse(text) }
          catch { throw new Error(`API ${method}: HTTP ${response.status} @ ${API_PATH} → ${text.slice(0,200)}`) }
          if (envelope?.ok === true) return envelope.value
          throw new Error(envelope?.error?.message ?? envelope?.error?.code ?? `http ${response.status}`)
        } finally {
          clearTimeout(timer)
        }
      }
      return {
        call,
        summary: () => call('summary'),
        runCheckin: () => call('runCheckin', {}, CLAIM_TIMEOUT_MS),
        checkinState: () => call('checkinState'),
        accounts: provider => call('accounts', { provider }),
        balances: provider => call('balances', { provider }),
        claim: provider => call('claim', { provider }, CLAIM_TIMEOUT_MS),
        exportBackup: () => call('exportBackup', {}, CLAIM_TIMEOUT_MS),
        updateSettings: patch => call('updateSettings', patch),
        createAccount: (provider, extra) => call('createAccount', { provider, ...extra }, 90_000),
        pollLogin: (accountId, provider) => call('pollLogin', { accountId, provider }),
      }
    }

    function readConnection(ctx) {
      try {
        return ctx.connection ?? ctx.get?.('connection') ?? null
      } catch {
        return null
      }
    }

    // ── formatAmount, duplicated from src/runs.js ─────────────────────────────
    // The host half imports the real one; this bundle cannot reach it, and a
    // 8-line pure function is cheaper to carry than a build step.
    function formatAmount(n) {
      const value = Number(n)
      if (!Number.isFinite(value)) return '0'
      const abs = Math.abs(value)
      if (abs >= 1e9) return `${trimZero(value / 1e9)}B`
      if (abs >= 1e6) return `${trimZero(value / 1e6)}M`
      if (abs >= 1e4) return `${trimZero(value / 1e3)}K`
      return String(Math.round(value))
    }
    function trimZero(x) {
      const fixed = x.toFixed(2).replace(/\.?0+$/, '')
      return fixed
    }

    // ── the five sections ─────────────────────────────────────────────────────
    // They live in THIS file on purpose: the ModuleLoader `require` resolves
    // host packages (react), not sibling files, so splitting the page into
    // its own module makes it fail to load inside the shell.
    // (They started in src/client/sections.js + page.js; both were inlined
    // and deleted so there is exactly one implementation.)
    const OUTCOME_LABELS = {
      claimed: '已领取',
      already: '今日已领',
      inactive: '未开启',
      skipped: '无签到',
      failed: '失败',
    }

    function Card({ title, action, children }) {
      return h('section', { className: 'ma-card' },
        h('div', { className: 'ma-card-head' }, h('h3', {}, title), action ?? null),
        children)
    }

    function CheckinSection({ client, summary, busy, setBusy, refresh, setError }) {
      const checkin = summary?.checkin
      const ranToday = checkin?.ranToday === true

      const run = useCallback(async () => {
        setBusy('checkin')
        try {
          const result = await client.runCheckin()
          setError(result?.alreadyRanToday === true ? '今天已经跑过了。' : '')
          await refresh()
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy('')
        }
      }, [client, refresh, setBusy, setError])

      const patchSettings = useCallback(async patch => {
        try {
          await client.updateSettings(patch)
          await refresh()
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }, [client, refresh, setError])

      return h(Card, {
        title: '每日签到',
        action: h('button', {
          type: 'button',
          className: 'ma-button ma-button-primary',
          disabled: busy !== '' || ranToday,
          onClick: run,
        }, busy === 'checkin' ? '运行中…' : ranToday ? '今日已跑' : '立即运行'),
      },
        h('p', { className: 'ma-status' },
          ranToday
            ? `今日已运行：${checkin?.lastResult || '无记录'}`
            : checkin?.running === true ? '正在运行…' : '今天还没有运行。'),
        h('label', { className: 'ma-switch' },
          h('input', {
            type: 'checkbox',
            checked: summary?.settings?.autoCheckin !== false,
            onChange: event => void patchSettings({ autoCheckin: event.target.checked }),
          }),
          h('span', {}, '自动运行')),
        h('label', { className: 'ma-field' },
          h('span', {}, '运行时间（UTC+8）'),
          h('input', {
            type: 'number',
            min: '0',
            max: '23',
            value: String(summary?.settings?.runHour ?? 9),
            onChange: event => void patchSettings({ runHour: Number(event.target.value) }),
          })),
        h('p', { className: 'ma-hint' },
          '错过（宿主关机）的轮次会在下次启动 30 秒后补跑；一轮只领到"无签到/未开启"不记今日，下次启动重试。'),
        h(ResultTable, { rows: checkin?.rows ?? [] }),
        h('p', { className: 'ma-hint' },
          `参与自动签到的渠道：${(summary?.channels ?? []).map(c => c.name).join('、')}。`))
    }

    function ResultTable({ rows }) {
      if (rows.length === 0) return null
      return h('table', { className: 'ma-table' },
        h('thead', {}, h('tr', {}, h('th', {}, '渠道'), h('th', {}, '结果'), h('th', {}, '详情'))),
        h('tbody', {}, rows.map((row, index) => {
          const detail = row.outcome === 'claimed'
            ? [row.credit > 0 ? `${formatAmount(row.credit)} 积分` : '', row.token > 0 ? `${formatAmount(row.token)} Token` : '']
              .filter(Boolean).join(' + ') || '—'
            : row.message ?? '—'
          return h('tr', { key: `${row.channel}-${index}` },
            h('td', {}, row.channel),
            h('td', { className: `ma-outcome ma-outcome-${row.outcome}` }, OUTCOME_LABELS[row.outcome] ?? row.outcome),
            h('td', {}, detail))
        })))
    }

    function UsageSection({ client, setError }) {
      const [data, setData] = useState(null)
      const [days, setDays] = useState(7)
      const [loading, setLoading] = useState(false)

      const load = useCallback(async (d) => {
        setLoading(true)
        try {
          const res = await client.call('usage', { days: d })
          setData(res?.value ?? res)
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally { setLoading(false) }
      }, [setError])

      useEffect(() => { void load(days) }, [days, load])

      const byChannel = data?.byChannel ?? {}
      const byModel = data?.byModel ?? {}
      const chEntries = Object.entries(byChannel).sort((a,b) => b[1].tokens - a[1].tokens)
      const mEntries = Object.entries(byModel).sort((a,b) => b[1].tokens - a[1].tokens)

      return h('div', {},
        h(Card, { title: '用量统计' },
          h('div', { style: { display:'flex', gap:8, marginBottom:12 } },
            [1,7,30].map(d => h('button', {
              key:d, type:'button',
              className: `ma-tab${days===d?' is-active':''}`,
              onClick: () => setDays(d),
            }, `${d}天`))),
          loading && h('p', { className:'ma-hint' }, '加载中…'),
          !data ? null : h('div', {},
            h('div', { style:{display:'flex',gap:24,marginBottom:16,flexWrap:'wrap'} },
              stat('总调用', data.totalCalls ?? 0),
              stat('失败', data.failures ?? 0),
              stat('平均延迟', (data.avgLatencyMs ?? 0)+'ms'),
              stat('Prompt', fmtTokens(data.totalPromptTokens)),
              stat('Completion', fmtTokens(data.totalCompletionTokens))),
            h('h4', { style:{margin:'12px 0 6px'} }, '按渠道'),
            h('table', { className:'ma-table' },
              h('thead', {}, h('tr', {},
                h('th', {}, '渠道'), h('th', {}, '调用'), h('th', {}, 'Tokens'),
                h('th', {}, '失败'), h('th', {}, '平均延迟'))),
              h('tbody', {}, chEntries.length === 0
                ? h('tr', {}, h('td', { colSpan:5, className:'ma-hint' }, '暂无数据'))
                : chEntries.map(([ch, s]) => h('tr', { key: ch },
                    h('td', {}, ch),
                    h('td', {}, s.calls),
                    h('td', {}, fmtTokens(s.tokens)),
                    h('td', {}, s.failures),
                    h('td', {}, s.calls ? Math.round(s.totalLatency/s.calls)+'ms' : '-'))))),
            h('h4', { style:{margin:'16px 0 6px'} }, '按模型'),
            h('table', { className:'ma-table' },
              h('thead', {}, h('tr', {}, h('th', {}, '模型'), h('th', {}, '调用'), h('th', {}, 'Tokens'))),
              h('tbody', {}, mEntries.length === 0
                ? h('tr', {}, h('td', { colSpan:3, className:'ma-hint' }, '暂无数据'))
                : mEntries.map(([m, s]) => h('tr', { key: m },
                    h('td', {}, m), h('td', {}, s.calls), h('td', {}, fmtTokens(s.tokens)))))),
          )
        )
      )
    }

    function stat(label, value) {
      return h('div', {},
        h('div', { style:{fontSize:22,fontWeight:600} }, value),
        h('div', { className:'ma-hint' }, label))
    }
    function fmtTokens(n) {
      if (!n) return '0'
      if (n >= 1e6) return (n/1e6).toFixed(1)+'M'
      if (n >= 1e3) return (n/1e3).toFixed(1)+'K'
      return String(n)
    }

    function RouteSection({ client, summary, setError }) {
      const [data, setData] = useState(null)
      const [readError, setReadError] = useState('')

      const load = useCallback(async () => {
        try {
          setData(await client.call('routes'))
          setReadError('')
        } catch (cause) {
          setReadError(String(cause?.message ?? cause))
        }
      }, [client])

      useEffect(() => { void load() }, [load])

      const mutate = useCallback(async (method, payload) => {
        try {
          await client.call(method, payload)
          await load()
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        }
      }, [client, load, setError])

      const entries = data?.entries ?? []
      const dispatch = data?.dispatch ?? []

      return h('div', { className: 'ma-routes' },
        h(Card, { title: '模型路由' },
          h('p', { className: 'ma-hint' },
            '同一个模型在多个渠道可用时，路由把它归成一个条目：按候选顺序发请求，某个渠道在产出任何内容前失败，'
            + '自动换下一个。点候选上的 ☆ 置顶该渠道，★ 的顺序就是优先顺序。'),
          summary?.route !== true
            ? h('p', { className: 'ma-status' }, '路由未启用（本组合没有 llm 服务）。')
            : readError !== ''
              ? h('p', { className: 'ma-status' }, `读取失败：${readError}`)
              : entries.length === 0
                ? h('p', { className: 'ma-status' },
                    '暂无路由条目——登录至少一个渠道后，它们目录里的模型会自动出现在这里。')
                : entries.map(entry => h(RouteRow, {
                    key: entry.key,
                    entry,
                    dispatch,
                    mutate,
                  }))))
    }

    function RouteRow({ entry, dispatch, mutate }) {
      const pinned = entry.pinned ?? []
      const togglePin = channel => {
        const current = [...pinned]
        const at = current.indexOf(channel)
        if (at >= 0) current.splice(at, 1)
        else {
          current.unshift(channel)
        }
        void mutate('routeSetPinned', { key: entry.key, pinned: current })
      }

      return h('div', { className: 'ma-route-row' },
        h('div', { className: 'ma-route-head' },
          h('span', { className: 'ma-route-name' }, entry.name),
          h('span', { className: 'ma-route-count' }, `${entry.candidates.length} 渠道`),
          h('select', {
            className: 'ma-select',
            value: entry.strategy,
            onChange: event => void mutate('routeSetStrategy', { key: entry.key, strategy: event.target.value }),
          },
            h('option', { value: 'smart' }, '智能'),
            h('option', { value: 'order' }, '顺序'),
            h('option', { value: 'rotate' }, '轮流'),
            h('option', { value: 'usage' }, '少用优先'),
            h('option', { value: 'fast' }, '速度优先'),
            h('option', { value: 'weight' }, '按权重'),
            h('option', { value: 'pace' }, '重置前用完'))),
        h('p', { className: 'ma-hint' }, capacityText(entry)),
        h('div', { className: 'ma-route-candidates' },
          entry.candidates.map((candidate, index) => {
            const isPinned = pinned.includes(candidate.channel)
            const turns = dispatch.find(d => d.model === entry.key && d.channel === candidate.channel)?.turns
            return h('button', {
              key: candidate.channel,
              type: 'button',
              className: `ma-chip${isPinned ? ' is-pinned' : ''}`,
              title: isPinned ? `取消优先：${candidate.channel}` : `优先使用：${candidate.channel}`,
              onClick: () => togglePin(candidate.channel),
            },
              h('span', { className: 'ma-chip-order' }, String(index + 1)),
              candidate.channel,
              isPinned ? ' ★' : ' ☆',
              Number.isFinite(turns) && turns > 0
                ? h('span', { className: 'ma-chip-turns' }, `${turns} 次`)
                : null)
          })),
        h(RuleEditor, { entry, mutate, channels: entry.candidates.map(c => c.channel) })
      )
    }

    function RuleEditor({ entry, mutate, channels }) {
      const [open, setOpen] = useState(false)
      const [rules, setRules] = useState(entry.rules ?? [])
      const [form, setForm] = useState({ targetChannel: channels[0] ?? '', minTokens: '', hasImages: false, timeWindow: '' })

      useEffect(() => { setRules(entry.rules ?? []) }, [entry.rules])

      const add = () => {
        const rule = {
          id: 'r' + Date.now(),
          targetChannel: form.targetChannel,
          ...form.minTokens !== '' ? { minTokens: Number(form.minTokens) } : {},
          ...form.hasImages ? { hasImages: true } : {},
          ...form.timeWindow ? { timeWindow: form.timeWindow } : {},
          enabled: true,
        }
        const next = [...rules, rule]
        setRules(next)
        void mutate('routeSetRules', { key: entry.key, rules: next })
        setForm({ targetChannel: channels[0] ?? '', minTokens: '', hasImages: false, timeWindow: '' })
      }
      const remove = (id) => {
        const next = rules.filter(r => r.id !== id)
        setRules(next)
        void mutate('routeSetRules', { key: entry.key, rules: next })
      }

      return h('div', { style: { marginTop: 8 } },
        h('button', { type:'button', className:'ma-link', onClick: () => setOpen(o => !o) },
          open ? '▾ 规则' : '▸ 规则 (' + rules.length + ')'),
        !open ? null : h('div', { style:{marginTop:8,paddingLeft:12,borderLeft:'2px solid #e5e5e5'} },
          rules.length === 0 ? h('p',{className:'ma-hint'},'暂无规则。命中规则时，指定渠道会被置顶。')
          : rules.map(r => h('div', { key:r.id, style:{display:'flex',gap:8,alignItems:'center',margin:'4px 0'} },
              h('span',{style:{flex:1}}),
              h('code',{}, r.targetChannel),
              r.minTokens ? h('span',{className:'ma-hint'}, ' ≥'+r.minTokens+'tok') : null,
              r.hasImages ? h('span',{className:'ma-hint'}, ' 含图片') : null,
              r.timeWindow ? h('span',{className:'ma-hint'}, ' '+r.timeWindow) : null,
              h('button',{type:'button',onClick:()=>remove(r.id),style:{color:'#c00'}},'×'))),
          h('div', { style:{display:'flex',gap:6,marginTop:8,flexWrap:'wrap',alignItems:'center'} },
            h('select', { className:'ma-select', value:form.targetChannel,
              onChange:e=>setForm(f=>({...f,targetChannel:e.target.value})) },
              channels.map(c => h('option',{key:c,value:c}, c))),
            h('input', { type:'number', placeholder:'最少 tokens', style:{width:90,padding:'2px 6px'},
              value:form.minTokens, onChange:e=>setForm(f=>({...f,minTokens:e.target.value})) }),
            h('label',{style:{fontSize:12}},
              h('input',{type:'checkbox',checked:form.hasImages,
                onChange:e=>setForm(f=>({...f,hasImages:e.target.checked}))}),' 图片'),
            h('input', { type:'text', placeholder:'时段 14:00-18:00', style:{width:120,padding:'2px 6px'},
              value:form.timeWindow, onChange:e=>setForm(f=>({...f,timeWindow:e.target.value})) }),
            h('button',{type:'button',onClick:add,className:'ma-btn'},'+ 添加'))
        )
      )
    }

    function capacityText(entry) {
      const caps = []
      if (Number.isFinite(entry.contextWindow)) caps.push(`上下文 ${formatAmount(entry.contextWindow)}`)
      if (Number.isFinite(entry.maxTokens)) caps.push(`输出 ${formatAmount(entry.maxTokens)}`)
      caps.push(`模态 ${(entry.inputModalities ?? ['text']).join('/')}`)
      return `容量取候选交集：${caps.join(' · ')}`
    }

    function AccountsSection({ client, summary, setError }) {
      const channels = (summary?.channels ?? []).map(c => c.id)
      const [loginChannel, setLoginChannel] = useState(channels[0] ?? '')
      const [loginState, setLoginState] = useState(null)
      const [loginBusy, setLoginBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [reloadKey, setReloadKey] = useState(0)

      // Keep the channel list in sync with the dropdown default.
      useEffect(() => {
        if (loginChannel === '' && channels.length > 0) setLoginChannel(channels[0])
      }, [channels, loginChannel])

      // Poll a pending login until the pack sees the credential, or 10 minutes elapse.
      useEffect(() => {
        if (loginState === null) return undefined
        let alive = true
        const timer = setInterval(async () => {
          if (Date.now() - loginState.startedAt > 10 * 60_000) {
            if (alive) { setLoginState(null); setNotice('登录超时，请重试'); setLoginBusy(false) }
            return
          }
          try {
            const value = await client.pollLogin(loginState.accountId, loginState.provider)
            if (!alive) return
            if (value?.done === true) {
              setLoginState(null)
              setLoginBusy(false)
              if (value.success === false) {
                setNotice(`登录失败：${value.error ?? '未知原因'}`)
              } else {
                setNotice('登录成功')
                setReloadKey(k => k + 1)
              }
            } else if (typeof value?.error === 'string' && value.error !== '') {
              setLoginState(null)
              setLoginBusy(false)
              setNotice(`登录失败：${value.error}`)
            }
          } catch { /* keep polling */ }
        }, 3000)
        return () => { alive = false; clearInterval(timer) }
      }, [loginState, client])

      const startLogin = async () => {
        if (loginBusy || loginChannel === '') return
        setLoginBusy(true); setNotice('')
        let popup = null
        try {
          popup = window.open('about:blank', '_blank')
          if (popup) popup.opener = null
        } catch { popup = null }
        try {
          const value = await client.createAccount(loginChannel)
          const accountId = value?.accountId
          const url = value?.loginUrl
          if (typeof accountId !== 'string' || accountId === '') throw new Error('服务端未返回 accountId')
          if (typeof url === 'string' && url !== '') {
            try {
              if (popup && !popup.closed) { popup.location.replace(url) }
              else { window.open(url, '_blank', 'noopener') }
            } catch { window.open(url, '_blank', 'noopener') }
          }
          setLoginState({ accountId, provider: loginChannel, startedAt: Date.now() })
        } catch (cause) {
          try { popup?.close() } catch {}
          setLoginBusy(false)
          setNotice(`发起登录失败：${String(cause?.message ?? cause)}`)
          setError?.(String(cause?.message ?? cause))
        }
      }

      return h(Card, { title: '账号' },
        // ── add-account row ──
        h('div', { className: 'ma-login-row' },
          h('select', {
            className: 'ma-select',
            value: loginChannel,
            onChange: event => setLoginChannel(event.target.value),
          }, channels.map(id => h('option', { key: id, value: id }, id))),
          h('button', {
            type: 'button',
            className: 'ma-button ma-button-primary',
            disabled: loginBusy || loginChannel === '',
            onClick: startLogin,
          }, loginBusy && loginState ? '等待授权…' : '添加账号')),
        loginState !== null
          ? h('p', { className: 'ma-hint', role: 'status' }, '请在弹出的浏览器窗口中完成授权，完成后这里会自动刷新。')
          : null,
        notice !== '' ? h('p', { className: 'ma-hint' }, notice) : null,
        h('div', { className: 'ma-accounts' },
          channels.length === 0
            ? h('p', { className: 'ma-status' }, '没有可管理的渠道。')
            : channels.map(channel => h(AccountRow, { key: `${channel}-${reloadKey}`, client, channel, onChanged: () => setReloadKey(k => k + 1) }))),
        h('p', { className: 'ma-hint' },
          '选择渠道后点「添加账号」，在弹出的浏览器窗口完成登录即可。'))
    }

    function AccountRow({ client, channel, onChanged }) {
      const [text, setText] = useState('读取中…')
      const [busy, setBusy] = useState(false)
      useEffect(() => {
        let alive = true
        void client.accounts(channel)
          .then(result => {
            if (!alive) return
            const accounts = result?.accounts ?? []
            setText(accounts.length === 0
              ? '未登录'
              : `${accounts.length} 个账号（${accounts.filter(a => a.disabled !== true).length} 可用）`)
          })
          .catch(cause => {
            if (alive) setText(`读取失败：${String(cause?.message ?? cause)}`)
          })
        return () => { alive = false }
      }, [client, channel])

      const remove = async accountId => {
        if (!window.confirm('确定删除这个账号？')) return
        setBusy(true)
        try {
          await client.call('account.delete', { accountId, provider: channel })
          onChanged?.()
        } catch (cause) {
          setText(`删除失败：${String(cause?.message ?? cause)}`)
        } finally { setBusy(false) }
      }

      return h('div', { className: 'ma-account-row' },
        h('span', { className: 'ma-account-channel' }, channel),
        h('span', { className: 'ma-account-status' }, text),
        busy ? h('span', { className: 'ma-hint' }, '…') : null)
    }

    function CreditsSection({ client, summary }) {
      const channels = (summary?.channels ?? []).map(c => c.id)
      return h(Card, { title: '积分' },
        h('div', { className: 'ma-credits' },
          channels.length === 0
            ? h('p', { className: 'ma-status' }, '没有可管理的渠道。')
            : channels.map(channel => h(CreditRow, { key: channel, client, channel }))),
        h('p', { className: 'ma-hint' }, '积分与 Token 是两种单位，不合并求和。'))
    }

    function CreditRow({ client, channel }) {
      const [text, setText] = useState('读取中…')
      useEffect(() => {
        let alive = true
        void client.balances(channel)
          .then(result => {
            if (!alive) return
            const packs = result?.balances ?? []
            if (packs.length === 0) {
              setText('—')
              return
            }
            const credit = packs.filter(p => p.unit !== 'token').reduce((sum, p) => sum + (Number(p.remaining) || 0), 0)
            const token = packs.filter(p => p.unit === 'token').reduce((sum, p) => sum + (Number(p.remaining) || 0), 0)
            const parts = []
            if (credit > 0) parts.push(`${formatAmount(credit)} 积分`)
            if (token > 0) parts.push(`${formatAmount(token)} Token`)
            setText(parts.length > 0 ? parts.join(' · ') : '0')
          })
          .catch(cause => {
            if (alive) setText(`读取失败：${String(cause?.message ?? cause)}`)
          })
        return () => { alive = false }
      }, [client, channel])
      return h('div', { className: 'ma-credit-row' },
        h('span', { className: 'ma-credit-channel' }, channel),
        h('span', { className: 'ma-credit-value' }, text))
    }

    function BackupSection({ client, busy, setBusy, setError }) {
      const [note, setNote] = useState('')
      const run = useCallback(async () => {
        setBusy('backup')
        try {
          const result = await client.exportBackup()
          setError('')
          const name = result?.file ?? result?.path ?? ''
          setNote(name ? `已导出：${name}` : '已导出。')
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy('')
        }
      }, [client, setBusy, setError])

      return h(Card, { title: '备份' },
        h('p', { className: 'ma-hint' }, '导出包含各渠道登录凭据的归档。文件含敏感信息，请妥善保管。'),
        h('button', {
          type: 'button',
          className: 'ma-button ma-button-primary',
          disabled: busy !== '',
          onClick: run,
        }, busy === 'backup' ? '导出中…' : '导出凭据归档'),
        note === '' ? null : h('p', { className: 'ma-status' }, note))
    }

    // ── the page shell ────────────────────────────────────────────────────────
    const TABS = [
      ['checkin', '签到'],
      ['route', '路由'],
      ['usage', '用量'],
      ['accounts', '账号'],
      ['credits', '积分'],
      ['backup', '备份'],
    ]

    function ModelAdminPage({ client, t = key => key }) {
      const [tab, setTab] = useState('checkin')
      const [summary, setSummary] = useState(null)
      const [error, setError] = useState('')
      const [busy, setBusy] = useState('')

      const refresh = useCallback(async () => {
        setBusy('summary')
        try {
          const next = await client.summary()
          setSummary(next)
          setError(next?.pack === true ? '' : '渠道包未挂载：账号、签到与路由不可用，插件功能保持加载。')
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy('')
        }
      }, [client])

      useEffect(() => {
        void refresh()
      }, [refresh])

      const shared = { client, t, summary, busy, setBusy, refresh, setError }

      return h('div', { className: 'dsh-model-admin' },
        error === '' ? null : h('div', { className: 'ma-banner', role: 'alert' }, error),
        h('div', { className: 'ma-tabs', role: 'tablist' },
          TABS.map(([id, label]) => h('button', {
            key: id,
            type: 'button',
            role: 'tab',
            className: `ma-tab${tab === id ? ' is-active' : ''}`,
            'aria-selected': tab === id ? 'true' : 'false',
            onClick: () => setTab(id),
          }, label))),
        h('div', { className: 'ma-body', role: 'tabpanel' },
          h(Section, { tab, ...shared })))
    }

    function Section({ tab, ...shared }) {
      switch (tab) {
        case 'route':
          return h(RouteSection, { key: 'route', ...shared })
        case 'usage':
          return h(UsageSection, { key: 'usage', ...shared })
        case 'accounts':
          return h(AccountsSection, { key: 'accounts', ...shared })
        case 'credits':
          return h(CreditsSection, { key: 'credits', ...shared })
        case 'backup':
          return h(BackupSection, { key: 'backup', ...shared })
        default:
          return h(CheckinSection, { key: 'checkin', ...shared })
      }
    }

    /**
     * cordis client plugin: mount the page into the settings section slot.
     *
     * `label` is a function so the host re-reads it on a locale switch; `order`
     * places the row inside the settings panel's 集成 group, beside the other
     * management pages.
     */
    function apply(ctx) {
      const client = createApiClient(() => readConnection(ctx))
      const t = ctx.locale?.bind?.('modelAdmin') ?? (key => key)
      const label = () => t('nav') || 'Model Admin'

      const dispose = ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-model-admin',
        order: 40,
        label,
        locale: 'modelAdmin',
      }, props => h(ModelAdminPage, { ...props, client, t, label })))

      if (dispose !== undefined) ctx.effect(() => dispose, 'dsh-model-admin: settings section')
      injectStyles()
    }

    /** Cordis services this half renders through. */
    const inject = ['slots', 'locale', 'connection']

    exports.apply = apply
    exports.inject = inject
    exports.name = 'dsh-model-admin'
    // Test seams. The components are exposed here because this bundle is a
    // SINGLE FILE by contract (see the header): the ModuleLoader `require`
    // resolves host packages like `react`, not sibling files, so the page
    // cannot live in its own module. Checks reach the components through
    // this object instead of importing a file that does not ship.
    exports.__test = {
      createApiClient, API_PATH, formatAmount, OUTCOME_LABELS,
      ModelAdminPage, Section, CheckinSection, RouteSection,
      AccountsSection, CreditsSection, BackupSection,
      Card, ResultTable, RouteRow, capacityText,
    }
    return module.exports
  },
})

// ── styles ───────────────────────────────────────────────────────────────────

/**
 * The page's CSS, injected once per document. Colour comes from the shell's
 * own `--dsw-alias-*` theme tokens so the page survives a light/dark switch;
 * geometry is the panel's measured 564px content width.
 */
function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-model-admin-styles') !== null) return
  const style = document.createElement('style')
  style.id = 'dsh-model-admin-styles'
  style.textContent = `
.dsh-model-admin {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 14px;
  color: var(--dsw-alias-label-primary);
  font: 13px/1.55 var(--dsw-font-family, system-ui, sans-serif);
}
.dsh-model-admin *,
.dsh-model-admin *::before,
.dsh-model-admin *::after { box-sizing: border-box; }

.ma-tabs {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 4px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  padding-bottom: 8px;
}
.ma-tab {
  border: none;
  border-radius: 8px;
  padding: 6px 12px;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.ma-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.ma-tab.is-active {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  font-weight: 600;
}

.ma-body { flex: 1; min-height: 0; overflow-y: auto; }
.ma-banner {
  border: 0.5px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 34%, transparent);
  border-radius: 10px;
  padding: 8px 12px;
  color: var(--dsw-alias-label-secondary);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
  font-size: 12px;
}
.ma-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  padding: 14px 16px;
  background: var(--dsw-alias-bg-layer-1);
}
.ma-card + .ma-card { margin-top: 12px; }
.ma-card h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.ma-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.ma-status { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12.5px; }
.ma-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; }

.ma-button {
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 6px 14px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-layer-2);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}
.ma-button:hover:not(:disabled) { border-color: var(--dsw-alias-border-l3); }
.ma-button:disabled { opacity: 0.5; cursor: not-allowed; }
.ma-button-primary {
  border-color: transparent;
  color: var(--dsw-alias-label-primary-foreground);
  background: var(--dsw-alias-brand-primary);
}

.ma-field { display: flex; align-items: center; gap: 10px; font-size: 12.5px; }
.ma-field input[type="number"] {
  width: 64px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 4px 8px;
  color: inherit;
  background: var(--dsw-alias-bg-layer-2);
  font: inherit;
}
.ma-switch { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.ma-select {
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  padding: 4px 8px;
  color: inherit;
  background: var(--dsw-alias-bg-layer-2);
  font: inherit;
  font-size: 12px;
}

.ma-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.ma-table th {
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  padding: 6px 8px;
  color: var(--dsw-alias-label-tertiary);
  font-weight: 500;
  text-align: left;
}
.ma-table td {
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  padding: 6px 8px;
}
.ma-table tr:last-child td { border-bottom: none; }
.ma-outcome-claimed { color: var(--dsw-alias-state-success-primary); font-weight: 600; }
.ma-outcome-failed { color: var(--dsw-alias-state-error-primary); }
.ma-outcome-already, .ma-outcome-inactive, .ma-outcome-skipped { color: var(--dsw-alias-label-tertiary); }

.ma-routes { display: flex; flex-direction: column; gap: 10px; }
.ma-route-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  padding: 10px 12px;
  background: var(--dsw-alias-bg-layer-2);
}
.ma-route-head { display: flex; align-items: center; gap: 10px; }
.ma-route-name { font-weight: 600; font-size: 13px; }
.ma-route-count { color: var(--dsw-alias-label-tertiary); font-size: 11.5px; }
.ma-route-head .ma-select { margin-left: auto; }
.ma-route-candidates { display: flex; flex-wrap: wrap; gap: 6px; }
.ma-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  padding: 4px 10px;
  color: var(--dsw-alias-label-secondary);
  background: var(--dsw-alias-bg-layer-1);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}
.ma-chip:hover { border-color: var(--dsw-alias-state-business-primary); }
.ma-chip.is-pinned {
  border-color: var(--dsw-alias-state-business-primary);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
}
.ma-chip-order {
  display: inline-flex;
  width: 15px;
  height: 15px;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent);
  font-size: 10px;
  font-weight: 700;
}
.ma-chip-turns { color: var(--dsw-alias-label-tertiary); font-size: 10.5px; }

.ma-accounts, .ma-credits { display: flex; flex-direction: column; gap: 6px; }
.ma-account-row, .ma-credit-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1);
  padding: 7px 0;
  font-size: 12.5px;
}
.ma-login-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.ma-account-row:last-child, .ma-credit-row:last-child { border-bottom: none; }
.ma-account-channel, .ma-credit-channel { font-weight: 500; }
.ma-account-status, .ma-credit-value { color: var(--dsw-alias-label-secondary); }
`
  document.head.appendChild(style)
}
