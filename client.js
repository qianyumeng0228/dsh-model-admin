/**
 * dsh-model-admin — browser half.
 *
 * Registered as ONE settings section (「设置 → Model Admin」) through the
 * host's `settings.section` slot.
 *
 * This file is a hand-written ModuleLoader bundle: no build step, no
 * dependency beyond the `react` the shell already provides.
 *
 * Data is read over the plugin's own same-origin `/api/dsh-model-admin`
 * routes (served by the host half).
 */

// ── styles ─────────────────────────────────────────────────────────────────
function injectStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-model-admin-styles') !== null) return
  const style = document.createElement('style')
  style.id = 'dsh-model-admin-styles'
  style.textContent = MA_STYLES
  document.head.appendChild(style)
}

const MA_STYLES = `
.dsh-model-admin {
  --ma-border: var(--dsw-alias-border-l1, #e6e7ea);
  --ma-border-strong: var(--dsw-alias-border-l2, #d6d8dd);
  --ma-text: var(--dsw-alias-label-primary, #1d2129);
  --ma-text-2: var(--dsw-alias-label-secondary, #4e5969);
  --ma-text-3: var(--dsw-alias-label-tertiary, #86909c);
  --ma-bg: var(--dsw-alias-bg-layer-1, #ffffff);
  --ma-bg-2: var(--dsw-alias-bg-layer-2, #f6f7f9);
  --ma-brand: var(--dsw-alias-brand-primary, #165dff);
  --ma-success: var(--dsw-alias-state-success-primary, #00b42a);
  --ma-danger: var(--dsw-alias-state-error-primary, #f53f3f);
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  color: var(--ma-text);
  font: 13px/1.55 var(--dsw-font-family, -apple-system, "Segoe UI", system-ui, sans-serif);
}
.dsh-model-admin *, .dsh-model-admin *::before, .dsh-model-admin *::after { box-sizing: border-box; }

/* tabs */
.ma-tabs {
  display: flex; flex: none; flex-wrap: wrap; gap: 2px;
  border-bottom: 1px solid var(--ma-border);
  padding-bottom: 8px;
}
.ma-tab {
  border: none; border-radius: 8px; padding: 6px 14px;
  color: var(--ma-text-2); background: transparent;
  font: inherit; font-size: 12.5px; cursor: pointer;
}
.ma-tab:hover { background: var(--ma-bg-2); }
.ma-tab.is-active {
  color: var(--ma-text); background: var(--ma-bg-2); font-weight: 600;
}
.ma-body { flex: 1; min-height: 0; overflow-y: auto; padding-right: 2px; }
.ma-stack { display: flex; flex-direction: column; gap: 12px; }

.ma-banner {
  border: 1px solid color-mix(in srgb, var(--ma-danger) 30%, transparent);
  border-radius: 10px; padding: 8px 12px;
  color: var(--ma-text-2);
  background: color-mix(in srgb, var(--ma-danger) 8%, transparent);
  font-size: 12px;
}

/* cards */
.ma-card {
  display: flex; flex-direction: column; gap: 12px;
  border: 1px solid var(--ma-border);
  border-radius: 14px;
  padding: 16px 18px;
  background: var(--ma-bg);
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.03);
}
.ma-card-head {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: 14px;
}
.ma-card-titles { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ma-card h3 { margin: 0; font-size: 14.5px; font-weight: 650; }
.ma-card-sub { margin: 0; color: var(--ma-text-3); font-size: 12px; }

/* buttons & inputs */
.ma-button {
  border: 1px solid var(--ma-border-strong);
  border-radius: 9px; padding: 7px 16px;
  color: var(--ma-text); background: var(--ma-bg);
  font: inherit; font-size: 12.5px; font-weight: 500;
  cursor: pointer; white-space: nowrap;
  transition: border-color .15s, background .15s;
}
.ma-button:hover:not(:disabled) { border-color: var(--ma-text-3); background: var(--ma-bg-2); }
.ma-button:disabled { opacity: .55; cursor: not-allowed; }
.ma-button-primary {
  border-color: transparent; color: #fff; background: var(--ma-brand);
}
.ma-button-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--ma-brand) 88%, #000); }
.ma-select, .ma-num-input, .ma-rule-input {
  border: 1px solid var(--ma-border-strong);
  border-radius: 9px; padding: 6px 10px;
  color: var(--ma-text); background: var(--ma-bg);
  font: inherit; font-size: 12.5px;
}
.ma-select:focus, .ma-num-input:focus, .ma-rule-input:focus {
  outline: 2px solid color-mix(in srgb, var(--ma-brand) 28%, transparent);
  outline-offset: -1px;
}
.ma-num-input { width: 64px; }
.ma-field { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.ma-switch, .ma-check { display: flex; align-items: center; gap: 7px; font-size: 12.5px; cursor: pointer; }
.ma-inline-settings {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  padding-top: 12px; border-top: 1px dashed var(--ma-border);
}

/* segmented control */
.ma-segmented {
  display: inline-flex; padding: 3px; gap: 2px;
  border: 1px solid var(--ma-border);
  border-radius: 10px; background: var(--ma-bg-2);
}
.ma-seg-item {
  border: none; border-radius: 7px; padding: 5px 14px;
  color: var(--ma-text-2); background: transparent;
  font: inherit; font-size: 12px; cursor: pointer;
}
.ma-seg-item.is-active {
  color: var(--ma-text); background: var(--ma-bg);
  font-weight: 600; box-shadow: 0 1px 2px rgba(16,24,40,.08);
}

/* channel icon */
.ma-channel-icon {
  display: inline-flex; flex: none; align-items: center; justify-content: center;
  border-radius: 8px; color: #fff; font-weight: 700; letter-spacing: .5px;
}

/* check-in */
.ma-checkin-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}
.ma-checkin-card {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid var(--ma-border);
  border-radius: 12px; padding: 11px 12px;
  background: var(--ma-bg);
}
.ma-checkin-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.ma-checkin-name { display: flex; align-items: center; gap: 7px; }
.ma-checkin-title { font-weight: 600; font-size: 12.5px; }
.ma-checkin-vendor {
  color: var(--ma-text-3); font-size: 10.5px;
  border: 1px solid var(--ma-border); border-radius: 5px; padding: 0 5px;
}
.ma-checkin-detail {
  color: var(--ma-text-2); font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ma-badge {
  flex: none; border-radius: 999px; padding: 2px 9px;
  font-size: 10.5px; font-weight: 600;
}
.ma-badge-claimed { color: var(--ma-success); background: color-mix(in srgb, var(--ma-success) 12%, transparent); }
.ma-badge-already { color: var(--ma-text-3); background: var(--ma-bg-2); }
.ma-badge-failed { color: var(--ma-danger); background: color-mix(in srgb, var(--ma-danger) 12%, transparent); }
.ma-badge-inactive, .ma-badge-skipped { color: var(--ma-text-3); background: var(--ma-bg-2); }

/* usage metrics */
.ma-metric-grid {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 10px;
}
.ma-metric {
  border: 1px solid var(--ma-border);
  border-radius: 12px; padding: 12px;
  background: var(--ma-bg-2);
}
.ma-metric-value { font-size: 22px; font-weight: 680; line-height: 1.2; }
.ma-metric-label { color: var(--ma-text-3); font-size: 11.5px; margin-top: 2px; }
.ma-metric.danger .ma-metric-value { color: var(--ma-danger); }

/* bar lists */
.ma-bar-list { display: flex; flex-direction: column; gap: 12px; }
.ma-bar-row { display: flex; flex-direction: column; gap: 6px; }
.ma-bar-head { display: flex; align-items: center; gap: 8px; }
.ma-bar-name { font-weight: 600; font-size: 12.5px; }
.ma-model-name { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }
.ma-bar-meta { color: var(--ma-text-3); font-size: 11px; margin-left: auto; }
.ma-bar-fail { color: var(--ma-danger); }
.ma-bar-track {
  height: 6px; border-radius: 999px;
  background: var(--ma-bg-2); overflow: hidden;
}
.ma-bar-fill {
  height: 100%; border-radius: 999px;
  background: var(--ma-brand);
  transition: width .3s ease;
}
.ma-bar-fill-model { background: linear-gradient(90deg, var(--ma-brand), color-mix(in srgb, var(--ma-brand) 60%, #a5b4fc)); }
.ma-model-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--ma-brand); flex: none;
}

/* route group */
.ma-route-group { padding: 18px; }
.ma-group-head { display: flex; align-items: flex-start; gap: 14px; }
.ma-group-titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.ma-group-name { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.ma-group-model { font-size: 16px; font-weight: 700; }
.ma-group-tag {
  color: var(--ma-text-2); font-size: 11px; font-weight: 500;
  border: 1px solid var(--ma-border); border-radius: 6px; padding: 1px 7px;
}
.ma-group-count { color: var(--ma-text-3); font-size: 12px; }
.ma-group-strategy-desc { margin: 0; color: var(--ma-text-2); font-size: 12px; line-height: 1.6; }
.ma-group-strategy-desc strong { color: var(--ma-text); font-weight: 600; }
.ma-group-policy { flex: none; }
.ma-policy-select {
  font-weight: 600; padding: 7px 12px; min-width: 92px;
}
.ma-candidate-list {
  display: flex; flex-direction: column; gap: 8px;
  padding: 4px 0;
}
.ma-candidate {
  display: flex; align-items: center; gap: 12px;
  width: 100%; text-align: left;
  border: 1px solid var(--ma-border);
  border-radius: 12px; padding: 12px 14px;
  color: var(--ma-text); background: var(--ma-bg);
  font: inherit; cursor: pointer;
  transition: border-color .15s, box-shadow .15s, background .15s;
}
.ma-candidate:hover { border-color: var(--ma-border-strong); background: var(--ma-bg-2); }
.ma-candidate.is-first {
  border-color: var(--ma-text);
  box-shadow: 0 1px 3px rgba(16,24,40,.1);
}
.ma-radio {
  display: inline-flex; flex: none; width: 18px; height: 18px;
  align-items: center; justify-content: center;
  border: 1.5px solid var(--ma-border-strong);
  border-radius: 50%;
}
.ma-radio.is-on { border-color: var(--ma-text); }
.ma-radio-dot { width: 9px; height: 9px; border-radius: 50%; background: transparent; }
.ma-radio.is-on .ma-radio-dot { background: var(--ma-text); }
.ma-candidate-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ma-candidate-title { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
.ma-candidate-name { font-weight: 650; font-size: 13.5px; }
.ma-candidate-accounts { color: var(--ma-text-3); font-size: 11.5px; }
.ma-candidate-model {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11.5px; color: var(--ma-text-2);
  background: var(--ma-bg-2); border-radius: 5px; padding: 1px 6px;
}
.ma-candidate-status { color: var(--ma-text-2); font-size: 11.5px; }
.ma-candidate-pin { flex: none; font-size: 17px; color: var(--ma-text-3); }
.ma-candidate-pin.is-on { color: #f5a623; }
.ma-cap-line { margin: 0; }

/* rules */
.ma-rules { border-top: 1px solid var(--ma-border); padding-top: 12px; }
.ma-rules-toggle {
  display: inline-flex; align-items: center; gap: 7px;
  border: none; background: transparent;
  color: var(--ma-text); font: inherit; font-size: 12.5px; font-weight: 600;
  cursor: pointer; padding: 0;
}
.ma-rules-chevron { color: var(--ma-text-3); }
.ma-rules-body { margin-top: 12px; }
.ma-rule-list { display: flex; flex-direction: column; gap: 8px; }
.ma-rule-item {
  display: flex; align-items: center; gap: 10px;
  border: 1px solid var(--ma-border); border-radius: 10px;
  padding: 9px 12px; background: var(--ma-bg-2);
}
.ma-rule-conditions { flex: 1; display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.ma-rule-target { font-weight: 600; font-size: 12.5px; }
.ma-rule-chip {
  color: var(--ma-text-2); font-size: 11px;
  border: 1px solid var(--ma-border); border-radius: 6px; padding: 1px 7px;
  background: var(--ma-bg);
}
.ma-rule-remove {
  border: none; background: transparent; color: var(--ma-danger);
  font-size: 16px; cursor: pointer; line-height: 1;
}
.ma-rule-form {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-top: 10px;
}
.ma-rule-input { width: auto; }
.ma-rule-input[placeholder] { min-width: 120px; }

/* login row */
.ma-login-row { display: flex; align-items: center; gap: 10px; }

/* manage grid (accounts + credits) */
.ma-manage-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
.ma-manage-card {
  display: flex; flex-direction: column; gap: 10px;
  border: 1px solid var(--ma-border); border-radius: 12px;
  padding: 13px; background: var(--ma-bg);
}
.ma-manage-head { display: flex; align-items: center; gap: 10px; }
.ma-manage-titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ma-manage-name { font-weight: 650; font-size: 13px; }
.ma-manage-sub { color: var(--ma-text-3); font-size: 11.5px; }
.ma-account-list { display: flex; flex-direction: column; gap: 4px; }
.ma-account-item {
  display: flex; align-items: center; gap: 8px;
  border-radius: 7px; padding: 5px 8px;
  background: var(--ma-bg-2); font-size: 12px;
}
.ma-account-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ma-success); flex: none; }
.ma-account-dot.is-off { background: var(--ma-text-3); }
.ma-account-nick { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ma-account-del {
  border: none; background: transparent; color: var(--ma-danger);
  font-size: 11px; cursor: pointer;
}
.ma-quota-list { display: flex; flex-direction: column; gap: 9px; }
.ma-quota-item { display: flex; flex-direction: column; gap: 5px; }
.ma-quota-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ma-quota-name { font-size: 11.5px; color: var(--ma-text-2); }
.ma-quota-text { font-size: 11px; color: var(--ma-text-3); }
.ma-quota-track {
  height: 6px; border-radius: 999px;
  background: var(--ma-bg-2); overflow: hidden;
}
.ma-quota-fill {
  height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, var(--ma-success), #4cd964);
}
`
window.__ModuleLoader__.load({
  id: 'dsh-model-admin',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useState, useEffect, useCallback, useMemo } = React

    const API_PATH = (() => {
      try { return new URL('api/dsh-model-admin', document.baseURI).pathname } catch { return '/api/dsh-model-admin' }
    })()
    const DEFAULT_TIMEOUT_MS = 60_000
    const CLAIM_TIMEOUT_MS = 120_000

    // ── the API client ───────────────────────────────────────────────────────
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

    // ── formatting helpers ───────────────────────────────────────────────────
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
      return x.toFixed(2).replace(/\.?0+$/, '')
    }
    function fmtTokens(n) {
      const v = Number(n)
      if (!v) return '0'
      if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
      if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
      return String(v)
    }

    // ── domain metadata: channel brand + strategy descriptions ───────────────
    const CHANNEL_META = {
      loomy:      { label: 'Loomy',       vendor: '讯飞',   color: '#10b981', glyph: 'L' },
      raccoon:    { label: 'Raccoon',     vendor: '商汤',   color: '#f59e0b', glyph: 'R' },
      zcode:      { label: 'ZCode',       vendor: '智谱',   color: '#4f46e5', glyph: 'Z' },
      lobsterai:  { label: 'LobsterAI',   vendor: '网易',   color: '#ef4444', glyph: 'L' },
      qoder:      { label: 'Qoder',       vendor: '阿里',   color: '#8b5cf6', glyph: 'Q' },
      qodercn:    { label: 'Qoder 中国版', vendor: '阿里',   color: '#8b5cf6', glyph: 'Q' },
      trae:       { label: 'TRAE',        vendor: '字节',   color: '#0ea5e9', glyph: 'T' },
      cline:      { label: 'Cline',       vendor: 'Cline',  color: '#64748b', glyph: 'C' },
      minimax:    { label: 'MiniMax',     vendor: 'MiniMax', color: '#ec4899', glyph: 'M' },
      minimaxintl:{ label: 'MiniMax 国际', vendor: 'MiniMax', color: '#ec4899', glyph: 'M' },
      buddy:      { label: 'CodeBuddy',   vendor: '腾讯',   color: '#22c55e', glyph: 'B' },
      workbuddy:  { label: 'WorkBuddy',   vendor: '腾讯',   color: '#14b8a6', glyph: 'W' },
      codearts:   { label: 'CodeArts',    vendor: '华为',   color: '#e11d48', glyph: 'C' },
      gemini:     { label: 'Gemini',      vendor: 'Google', color: '#3b82f6', glyph: 'G' },
      opencode:   { label: 'OpenCode',    vendor: 'OpenCode', color: '#0f172a', glyph: 'O' },
    }
    function channelMeta(channel) {
      return CHANNEL_META[channel] ?? { label: channel, vendor: '', color: '#64748b', glyph: (channel[0] ?? '?').toUpperCase() }
    }

    const STRATEGY_META = {
      smart:  { label: '智能', desc: '有余量的账号中额度最先重置的排第一，以免剩余额度在重置时作废；用到 90% 以上的，等其他都无法响应时才用；失败后休息中的排最后。' },
      order:  { label: '顺序', desc: '严格按候选顺序，第一个在产出前失败才用下一个。' },
      rotate: { label: '轮流', desc: '每轮依次换一个账号，把请求平均分摊。' },
      usage:  { label: '少用优先', desc: '剩余额度最多的账号排第一。' },
      fast:   { label: '速度优先', desc: '最近响应最快的账号排第一。' },
      weight: { label: '按权重', desc: '按各账号权重加权分配。' },
      pace:   { label: '重置前用完', desc: '优先在额度重置前把它用完。' },
    }
    const STRATEGY_ORDER = ['smart', 'order', 'rotate', 'usage', 'fast', 'weight', 'pace']

    const OUTCOME_LABELS = {
      claimed: '已领取',
      already: '今日已领',
      inactive: '未开启',
      skipped: '无签到',
      failed: '失败',
    }

    // ── primitives ──────────────────────────────────────────────────────────
    function ChannelIcon({ channel, size = 30 }) {
      const meta = channelMeta(channel)
      return h('span', {
        className: 'ma-channel-icon',
        style: { width: size, height: size, background: meta.color, fontSize: size * 0.52 },
      }, meta.glyph)
    }

    function Segmented({ options, value, onChange }) {
      return h('div', { className: 'ma-segmented', role: 'group' },
        options.map(opt => h('button', {
          key: opt.value,
          type: 'button',
          className: `ma-seg-item${value === opt.value ? ' is-active' : ''}`,
          onClick: () => onChange(opt.value),
        }, opt.label)))
    }

    function Card({ title, sub, action, children, className = '' }) {
      return h('section', { className: `ma-card ${className}` },
        (title || action) ? h('div', { className: 'ma-card-head' },
          h('div', { className: 'ma-card-titles' },
            title ? h('h3', {}, title) : null,
            sub ? h('p', { className: 'ma-card-sub' }, sub) : null),
          action ?? null) : null,
        children)
    }

    // ── check-in ─────────────────────────────────────────────────────────────
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

      const rows = checkin?.rows ?? []
      const claimedCount = rows.filter(r => r.outcome === 'claimed').length
      const alreadyCount = rows.filter(r => r.outcome === 'already').length

      return h('div', { className: 'ma-stack' },
        h(Card, {
          title: '每日签到',
          sub: ranToday
            ? `今日已运行 · ${claimedCount} 个新领取 · ${alreadyCount} 个已领`
            : checkin?.running === true ? '正在运行…' : '今天还没有运行',
          action: h('button', {
            type: 'button',
            className: `ma-button ${ranToday ? '' : 'ma-button-primary'}`,
            disabled: busy !== '' || ranToday,
            onClick: run,
          }, busy === 'checkin' ? '运行中…' : ranToday ? '今日已跑' : '立即运行'),
        },
          h('div', { className: 'ma-checkin-grid' },
            rows.length === 0
              ? h('p', { className: 'ma-hint' }, '暂无可签到渠道。')
              : rows.map(row => h(CheckinCard, { key: row.channel, row }))),
          h('div', { className: 'ma-inline-settings' },
            h('label', { className: 'ma-switch' },
              h('input', {
                type: 'checkbox',
                checked: summary?.settings?.autoCheckin !== false,
                onChange: event => void patchSettings({ autoCheckin: event.target.checked }),
              }),
              h('span', {}, '自动运行')),
            h('label', { className: 'ma-field' },
              h('span', { className: 'ma-hint' }, '运行时间 (UTC+8)'),
              h('input', {
                type: 'number', min: '0', max: '23',
                className: 'ma-num-input',
                value: String(summary?.settings?.runHour ?? 9),
                onChange: event => void patchSettings({ runHour: Number(event.target.value) }),
              }))),
          h('p', { className: 'ma-hint' },
            '错过（宿主关机）的轮次会在下次启动 30 秒后补跑；一轮只领到"无签到/未开启"不记今日，下次启动重试。'),
          h('p', { className: 'ma-hint' },
            `参与自动签到的渠道：${(summary?.channels ?? []).map(c => c.name).join('、')}。`)))
    }

    function CheckinCard({ row }) {
      const meta = channelMeta(row.channel)
      const isClaimed = row.outcome === 'claimed'
      const isAlready = row.outcome === 'already'
      const detail = row.outcome === 'claimed'
        ? [row.credit > 0 ? `${formatAmount(row.credit)} 积分` : '', row.token > 0 ? `${formatAmount(row.token)} Token` : '']
            .filter(Boolean).join(' + ')
        : row.message ?? ''
      return h('div', { className: `ma-checkin-card is-${row.outcome}` },
        h(ChannelIcon, { channel: row.channel }),
        h('div', { className: 'ma-checkin-info' },
          h('div', { className: 'ma-checkin-name' },
            h('span', { className: 'ma-checkin-title' }, meta.label),
            meta.vendor ? h('span', { className: 'ma-checkin-vendor' }, meta.vendor) : null),
          h('div', { className: 'ma-checkin-detail' },
            detail !== '' ? detail : (isClaimed || isAlready ? '今日额度已领取' : OUTCOME_LABELS[row.outcome] ?? row.outcome))),
        h('span', { className: `ma-badge ma-badge-${row.outcome}` }, OUTCOME_LABELS[row.outcome] ?? row.outcome))
    }

    // ── usage ───────────────────────────────────────────────────────────────
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
      const chEntries = Object.entries(byChannel).sort((a, b) => b[1].tokens - a[1].tokens)
      const mEntries = Object.entries(byModel).sort((a, b) => b[1].tokens - a[1].tokens)
      const maxChTokens = chEntries.reduce((m, [, s]) => Math.max(m, s.tokens), 0)
      const maxMTokens = mEntries.reduce((m, [, s]) => Math.max(m, s.tokens), 0)

      const metrics = data ? [
        { label: '总调用', value: String(data.totalCalls ?? 0) },
        { label: '失败', value: String(data.failures ?? 0), tone: (data.failures ?? 0) > 0 ? 'danger' : '' },
        { label: '平均延迟', value: `${Math.round(data.avgLatencyMs ?? 0)}ms` },
        { label: 'Prompt', value: fmtTokens(data.totalPromptTokens) },
        { label: 'Completion', value: fmtTokens(data.totalCompletionTokens) },
      ] : []

      return h('div', { className: 'ma-stack' },
        h(Card, {
          title: '用量统计',
          action: h(Segmented, {
            value: days,
            onChange: setDays,
            options: [
              { value: 1, label: '1 天' },
              { value: 7, label: '7 天' },
              { value: 30, label: '30 天' },
            ],
          }),
        },
          loading ? h('p', { className: 'ma-hint' }, '加载中…') : null,
          data
            ? h('div', { className: 'ma-metric-grid' },
                metrics.map(m => h('div', {
                  key: m.label,
                  className: `ma-metric ${m.tone ?? ''}`,
                },
                  h('div', { className: 'ma-metric-value' }, m.value),
                  h('div', { className: 'ma-metric-label' }, m.label))))
            : null),
        h(Card, { title: '按渠道', sub: 'Tokens 占比与调用结果' },
          chEntries.length === 0
            ? h('p', { className: 'ma-hint' }, '暂无数据')
            : h('div', { className: 'ma-bar-list' },
                chEntries.map(([ch, s]) => {
                  const width = maxChTokens ? (s.tokens / maxChTokens) * 100 : 0
                  return h('div', { key: ch, className: 'ma-bar-row' },
                    h('div', { className: 'ma-bar-head' },
                      h(ChannelIcon, { channel: ch, size: 22 }),
                      h('span', { className: 'ma-bar-name' }, channelMeta(ch).label),
                      h('span', { className: 'ma-bar-meta' },
                        `${s.calls} 次 · ${fmtTokens(s.tokens)}`,
                        s.failures > 0 ? h('span', { className: 'ma-bar-fail' }, ` · ${s.failures} 失败`) : null,
                        s.calls ? ` · ${Math.round(s.totalLatency / s.calls)}ms` : '')),
                    h('div', { className: 'ma-bar-track' },
                      h('div', {
                        className: 'ma-bar-fill',
                        style: { width: `${width}%`, background: channelMeta(ch).color },
                      })))
                }))),
        h(Card, { title: '按模型', sub: 'Tokens 占比' },
          mEntries.length === 0
            ? h('p', { className: 'ma-hint' }, '暂无数据')
            : h('div', { className: 'ma-bar-list' },
                mEntries.map(([m, s]) => {
                  const width = maxMTokens ? (s.tokens / maxMTokens) * 100 : 0
                  return h('div', { key: m, className: 'ma-bar-row' },
                    h('div', { className: 'ma-bar-head' },
                      h('span', { className: 'ma-model-dot' }),
                      h('span', { className: 'ma-bar-name ma-model-name' }, m),
                      h('span', { className: 'ma-bar-meta' }, `${s.calls} 次 · ${fmtTokens(s.tokens)}`)),
                    h('div', { className: 'ma-bar-track' },
                      h('div', {
                        className: 'ma-bar-fill ma-bar-fill-model',
                        style: { width: `${width}%` },
                      })))
                })))
      )
    }

    // ── routing ─────────────────────────────────────────────────────────────
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

      return h('div', { className: 'ma-stack' },
        summary?.route !== true
          ? h(Card, { title: '模型路由' }, h('p', { className: 'ma-status' }, '路由未启用（本组合没有 llm 服务）。'))
          : readError !== ''
            ? h(Card, { title: '模型路由' }, h('p', { className: 'ma-status' }, `读取失败：${readError}`))
            : entries.length === 0
              ? h(Card, { title: '模型路由' }, h('p', { className: 'ma-status' },
                  '暂无路由条目——登录至少一个渠道后，它们目录里的模型会自动出现在这里。'))
              : entries.map(entry => h(RouteGroupCard, { key: entry.key, entry, mutate })))
    }

    function RouteGroupCard({ entry, mutate }) {
      const strategy = STRATEGY_META[entry.strategy] ?? STRATEGY_META.smart
      const pinned = entry.pinned ?? []

      // Display order: pinned channels first (in pin order), then the rest.
      const ordered = useMemo(() => {
        const pinnedCands = pinned
          .map(ch => entry.candidates.find(c => c.channel === ch))
          .filter(Boolean)
        const rest = entry.candidates.filter(c => !pinned.includes(c.channel))
        return [...pinnedCands, ...rest]
      }, [entry, pinned])

      const togglePin = channel => {
        const current = [...pinned]
        const at = current.indexOf(channel)
        if (at >= 0) current.splice(at, 1)
        else current.unshift(channel)
        void mutate('routeSetPinned', { key: entry.key, pinned: current })
      }

      const setStrategy = value => {
        void mutate('routeSetStrategy', { key: entry.key, strategy: value })
      }

      const caps = []
      if (Number.isFinite(entry.contextWindow)) caps.push(`上下文 ${formatAmount(entry.contextWindow)}`)
      if (Number.isFinite(entry.maxTokens)) caps.push(`输出 ${formatAmount(entry.maxTokens)}`)
      caps.push(`模态 ${(entry.inputModalities ?? ['text']).join('/')}`)

      return h(Card, { className: 'ma-route-group' },
        h('div', { className: 'ma-group-head' },
          h('div', { className: 'ma-group-titles' },
            h('div', { className: 'ma-group-name' },
              h('span', { className: 'ma-group-model' }, entry.name),
              h('span', { className: 'ma-group-tag' }, '路由组'),
              h('span', { className: 'ma-group-count' }, `启用 ${entry.candidates.length} 个`)),
            h('p', { className: 'ma-group-strategy-desc' },
              h('strong', {}, `${strategy.label}：`), strategy.desc)),
          h('div', { className: 'ma-group-policy' },
            h('select', {
              className: 'ma-policy-select',
              value: entry.strategy,
              onChange: event => setStrategy(event.target.value),
            }, STRATEGY_ORDER.map(s => h('option', { key: s, value: s }, STRATEGY_META[s].label))))),
        h('div', { className: 'ma-candidate-list' },
          ordered.map((candidate, index) => h(CandidateCard, {
            key: candidate.channel,
            candidate,
            index,
            isFirst: index === 0,
            isPinned: pinned.includes(candidate.channel),
            onToggle: () => togglePin(candidate.channel),
          }))),
        h('p', { className: 'ma-hint ma-cap-line' }, `容量取候选交集：${caps.join(' · ')}`),
        h(RuleEditor, { entry, mutate }))
    }

    function CandidateCard({ candidate, index, isFirst, isPinned, onToggle }) {
      const meta = channelMeta(candidate.channel)
      const total = candidate.accountTotal
      const available = candidate.accountAvailable
      const statusParts = []
      if (Number.isFinite(available)) {
        statusParts.push(available === 0 ? '暂无可用账号' : `${available} 个可用`)
      }
      if (Number.isFinite(total) && total > 0) statusParts.push(`共 ${total} 个账号`)
      if (statusParts.length === 0) statusParts.push('账号数未知')

      return h('button', {
        type: 'button',
        className: `ma-candidate${isFirst ? ' is-first' : ''}${isPinned ? ' is-pinned' : ''}`,
        title: isPinned ? `取消优先：${meta.label}` : `优先使用：${meta.label}`,
        onClick: onToggle,
      },
        h('span', { className: `ma-radio ${isFirst ? 'is-on' : ''}` },
          h('span', { className: 'ma-radio-dot' })),
        h(ChannelIcon, { channel: candidate.channel, size: 34 }),
        h('div', { className: 'ma-candidate-info' },
          h('div', { className: 'ma-candidate-title' },
            h('span', { className: 'ma-candidate-name' }, meta.label),
            Number.isFinite(total) && total > 0
              ? h('span', { className: 'ma-candidate-accounts' }, `${total} 个账号`)
              : null,
            h('code', { className: 'ma-candidate-model' }, candidate.model)),
          h('div', { className: 'ma-candidate-status' }, statusParts.join(' · '))),
        h('span', { className: `ma-candidate-pin ${isPinned ? 'is-on' : ''}` }, isPinned ? '★' : '☆'))
    }

    // ── rule editor ─────────────────────────────────────────────────────────
    function RuleEditor({ entry, mutate }) {
      const channels = entry.candidates.map(c => c.channel)
      const [open, setOpen] = useState(false)
      const [rules, setRules] = useState(entry.rules ?? [])
      const [form, setForm] = useState({
        targetChannel: channels[0] ?? '',
        minTokens: '', hasImages: false, timeWindow: '',
      })

      useEffect(() => { setRules(entry.rules ?? []) }, [entry.rules])

      const commit = next => {
        setRules(next)
        void mutate('routeSetRules', { key: entry.key, rules: next })
      }
      const add = () => {
        const rule = {
          id: 'r' + Date.now(),
          targetChannel: form.targetChannel,
          ...form.minTokens !== '' ? { minTokens: Number(form.minTokens) } : {},
          ...form.hasImages ? { hasImages: true } : {},
          ...form.timeWindow ? { timeWindow: form.timeWindow } : {},
          enabled: true,
        }
        commit([...rules, rule])
        setForm({ targetChannel: channels[0] ?? '', minTokens: '', hasImages: false, timeWindow: '' })
      }
      const remove = id => commit(rules.filter(r => r.id !== id))

      return h('div', { className: 'ma-rules' },
        h('button', { type: 'button', className: 'ma-rules-toggle', onClick: () => setOpen(o => !o) },
          h('span', { className: 'ma-rules-chevron' }, open ? '▾' : '▸'),
          `规则 (${rules.length})`,
          h('span', { className: 'ma-hint' }, '命中时把指定渠道置顶')),
        !open ? null : h('div', { className: 'ma-rules-body' },
          rules.length === 0
            ? h('p', { className: 'ma-hint' }, '暂无规则。')
            : h('div', { className: 'ma-rule-list' },
                rules.map(r => h('div', { key: r.id, className: 'ma-rule-item' },
                  h(ChannelIcon, { channel: r.targetChannel, size: 22 }),
                  h('div', { className: 'ma-rule-conditions' },
                    h('span', { className: 'ma-rule-target' }, channelMeta(r.targetChannel).label),
                    r.minTokens ? h('span', { className: 'ma-rule-chip' }, `≥ ${r.minTokens} tokens`) : null,
                    r.hasImages ? h('span', { className: 'ma-rule-chip' }, '含图片') : null,
                    r.timeWindow ? h('span', { className: 'ma-rule-chip' }, r.timeWindow) : null),
                  h('button', { type: 'button', className: 'ma-rule-remove', onClick: () => remove(r.id) }, '×')))),
          h('div', { className: 'ma-rule-form' },
            h('select', {
              className: 'ma-select',
              value: form.targetChannel,
              onChange: e => setForm(f => ({ ...f, targetChannel: e.target.value })),
            }, channels.map(c => h('option', { key: c, value: c }, channelMeta(c).label))),
            h('input', {
              type: 'number', className: 'ma-num-input ma-rule-input', placeholder: '最少 tokens',
              value: form.minTokens,
              onChange: e => setForm(f => ({ ...f, minTokens: e.target.value })),
            }),
            h('label', { className: 'ma-check' },
              h('input', {
                type: 'checkbox', checked: form.hasImages,
                onChange: e => setForm(f => ({ ...f, hasImages: e.target.checked })),
              }), '图片'),
            h('input', {
              type: 'text', className: 'ma-rule-input', placeholder: '时段 14:00-18:00',
              value: form.timeWindow,
              onChange: e => setForm(f => ({ ...f, timeWindow: e.target.value })),
            }),
            h('button', { type: 'button', className: 'ma-button ma-button-primary', onClick: add }, '+ 添加'))))
    }

    // ── accounts ────────────────────────────────────────────────────────────
    function AccountsSection({ client, summary, setError }) {
      const channels = (summary?.channels ?? []).map(c => c.id)
      const [loginChannel, setLoginChannel] = useState(channels[0] ?? '')
      const [loginState, setLoginState] = useState(null)
      const [loginBusy, setLoginBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const [reloadKey, setReloadKey] = useState(0)

      useEffect(() => {
        if (loginChannel === '' && channels.length > 0) setLoginChannel(channels[0])
      }, [channels, loginChannel])

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
              if (value.success === false) setNotice(`登录失败：${value.error ?? '未知原因'}`)
              else { setNotice('登录成功'); setReloadKey(k => k + 1) }
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
              if (popup && !popup.closed) popup.location.replace(url)
              else window.open(url, '_blank', 'noopener')
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

      return h('div', { className: 'ma-stack' },
        h(Card, {
          title: '添加账号',
          sub: '选择渠道后点「添加账号」，在弹出的浏览器窗口完成登录',
          action: h('button', {
            type: 'button',
            className: 'ma-button ma-button-primary',
            disabled: loginBusy || loginChannel === '',
            onClick: startLogin,
          }, loginBusy && loginState ? '等待授权…' : '添加账号'),
        },
          h('div', { className: 'ma-login-row' },
            h('select', {
              className: 'ma-select',
              value: loginChannel,
              onChange: event => setLoginChannel(event.target.value),
            },
              channels.map(id => h('option', { key: id, value: id }, channelMeta(id).label)))),
          loginState !== null
            ? h('p', { className: 'ma-hint', role: 'status' }, '请在弹出的浏览器窗口中完成授权，完成后这里会自动刷新。')
            : null,
          notice !== '' ? h('p', { className: 'ma-hint' }, notice) : null),
        h(Card, { title: '账号总览' },
          channels.length === 0
            ? h('p', { className: 'ma-status' }, '没有可管理的渠道。')
            : h('div', { className: 'ma-manage-grid' },
                channels.map(channel => h(ManageAccountCard, {
                  key: `${channel}-${reloadKey}`,
                  client,
                  channel,
                  onChanged: () => setReloadKey(k => k + 1),
                })))))
    }

    function ManageAccountCard({ client, channel, onChanged }) {
      const [accounts, setAccounts] = useState(null)
      const [error, setLocalError] = useState('')
      const [busy, setBusy] = useState(false)

      const load = useCallback(() => {
        let alive = true
        void client.accounts(channel)
          .then(result => {
            if (!alive) return
            setAccounts(result?.accounts ?? [])
            setLocalError('')
          })
          .catch(cause => { if (alive) setLocalError(String(cause?.message ?? cause)) })
        return () => { alive = false }
      }, [client, channel])

      useEffect(load, [load])

      const remove = async accountId => {
        if (!window.confirm('确定删除这个账号？')) return
        setBusy(true)
        try {
          await client.call('account.delete', { accountId, provider: channel })
          onChanged?.()
        } catch (cause) {
          setLocalError(`删除失败：${String(cause?.message ?? cause)}`)
        } finally { setBusy(false) }
      }

      const list = accounts ?? []
      const available = list.filter(a => a?.disabled !== true && a?.enabled !== false).length

      return h('div', { className: 'ma-manage-card' },
        h('div', { className: 'ma-manage-head' },
          h(ChannelIcon, { channel, size: 30 }),
          h('div', { className: 'ma-manage-titles' },
            h('div', { className: 'ma-manage-name' }, channelMeta(channel).label),
            h('div', { className: 'ma-manage-sub' },
              error !== '' ? `读取失败：${error}`
                : accounts === null ? '读取中…'
                : list.length === 0 ? '未登录'
                : `${list.length} 个账号 · ${available} 可用`)),
          busy ? h('span', { className: 'ma-hint' }, '…') : null),
        list.length === 0 ? null : h('div', { className: 'ma-account-list' },
          list.map(a => h('div', { key: a.id, className: 'ma-account-item' },
            h('span', { className: `ma-account-dot ${a?.disabled ? 'is-off' : ''}` }),
            h('span', { className: 'ma-account-nick' }, a.nickname ?? a.id),
            h('button', {
              type: 'button', className: 'ma-account-del',
              onClick: () => remove(a.id),
            }, '删除')))))
    }

    // ── credits ─────────────────────────────────────────────────────────────
    function CreditsSection({ client, summary }) {
      const channels = (summary?.channels ?? []).map(c => c.id)
      return h('div', { className: 'ma-stack' },
        h(Card, {
          title: '积分与额度',
          sub: '积分与 Token 是两种单位，不合并求和',
        },
          channels.length === 0
            ? h('p', { className: 'ma-status' }, '没有可管理的渠道。')
            : h('div', { className: 'ma-manage-grid' },
                channels.map(channel => h(CreditCard, { key: channel, client, channel })))))
    }

    function CreditCard({ client, channel }) {
      const [packs, setPacks] = useState(null)
      const [error, setLocalError] = useState('')

      useEffect(() => {
        let alive = true
        void client.balances(channel)
          .then(result => {
            if (!alive) return
            setPacks(result?.balances ?? [])
            setLocalError('')
          })
          .catch(cause => { if (alive) setLocalError(String(cause?.message ?? cause)) })
        return () => { alive = false }
      }, [client, channel])

      const list = packs ?? []
      const lines = list.map(p => {
        const remaining = Number(p.remaining) || 0
        const total = Number(p.total) || 0
        const unit = p.unit === 'token' ? 'Token' : '积分'
        const ratio = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : null
        return { key: p.id ?? p.name ?? unit, name: p.name ?? unit, remaining, total, unit, ratio }
      })

      return h('div', { className: 'ma-manage-card' },
        h('div', { className: 'ma-manage-head' },
          h(ChannelIcon, { channel, size: 30 }),
          h('div', { className: 'ma-manage-titles' },
            h('div', { className: 'ma-manage-name' }, channelMeta(channel).label),
            h('div', { className: 'ma-manage-sub' },
              error !== '' ? `读取失败：${error}`
                : packs === null ? '读取中…'
                : lines.length === 0 ? '—'
                : lines.map(l => `${formatAmount(l.remaining)} ${l.unit}`).join(' · ')))),
        lines.length === 0 ? null : h('div', { className: 'ma-quota-list' },
          lines.map(l => h('div', { key: l.key, className: 'ma-quota-item' },
            h('div', { className: 'ma-quota-head' },
              h('span', { className: 'ma-quota-name' }, l.name),
              h('span', { className: 'ma-quota-text' },
                l.ratio === null
                  ? `${formatAmount(l.remaining)} ${l.unit}`
                  : `${formatAmount(l.remaining)} / ${formatAmount(l.total)} ${l.unit} · 剩余 ${Math.round(l.ratio * 100)}%`)),
            l.ratio === null ? null : h('div', { className: 'ma-quota-track' },
              h('div', { className: 'ma-quota-fill', style: { width: `${l.ratio * 100}%` } }))))))
    }

    // ── backup ──────────────────────────────────────────────────────────────
    function BackupSection({ client, busy, setBusy, setError }) {
      const [note, setNote] = useState('')
      const run = useCallback(async () => {
        setBusy('backup')
        try {
          const result = await client.exportBackup()
          setError('')
          const fileName = result?.file ?? result?.path ?? ''
          setNote(fileName ? `已导出：${fileName}` : '已导出。')
        } catch (cause) {
          setError(String(cause?.message ?? cause))
        } finally {
          setBusy('')
        }
      }, [client, setBusy, setError])

      return h(Card, {
        title: '备份',
        sub: '导出包含各渠道登录凭据的归档，文件含敏感信息，请妥善保管',
        action: h('button', {
          type: 'button',
          className: 'ma-button ma-button-primary',
          disabled: busy !== '',
          onClick: run,
        }, busy === 'backup' ? '导出中…' : '导出凭据归档'),
      },
        note === '' ? null : h('p', { className: 'ma-status' }, note))
    }

    // ── the page shell ──────────────────────────────────────────────────────
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

      useEffect(() => { void refresh() }, [refresh])

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
        case 'route': return h(RouteSection, { key: 'route', ...shared })
        case 'usage': return h(UsageSection, { key: 'usage', ...shared })
        case 'accounts': return h(AccountsSection, { key: 'accounts', ...shared })
        case 'credits': return h(CreditsSection, { key: 'credits', ...shared })
        case 'backup': return h(BackupSection, { key: 'backup', ...shared })
        default: return h(CheckinSection, { key: 'checkin', ...shared })
      }
    }

    function apply(ctx) {
      const client = createApiClient(() => readConnection(ctx))
      const t = ctx.locale?.bind?.('modelAdmin') ?? (key => key)
      const label = () => {
        const v = t('nav')
        return v && v !== 'nav' ? v : 'Model Admin'
      }

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

    const inject = ['slots', 'locale', 'connection']

    exports.apply = apply
    exports.inject = inject
    exports.name = 'dsh-model-admin'
    exports.__test = {
      createApiClient, API_PATH, formatAmount, OUTCOME_LABELS,
      ModelAdminPage, Section, CheckinSection, RouteSection,
      AccountsSection, CreditsSection, BackupSection, UsageSection,
      Card, ChannelIcon, Segmented, RouteGroupCard, CandidateCard,
    }
    return module.exports
  },
})








