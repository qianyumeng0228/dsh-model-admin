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

    const API_PATH = '/api/dsh-model-admin'
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
          const envelope = await response.json()
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
      }
    }

    function readConnection(ctx) {
      try {
        return ctx.connection ?? ctx.get?.('connection') ?? null
      } catch {
        return null
      }
    }

    // ── the page ─────────────────────────────────────────────────────────────
    const { ModelAdminPage } = require('./src/client/page.js')

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
    exports.__test = { createApiClient, API_PATH }
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
.ma-account-row:last-child, .ma-credit-row:last-child { border-bottom: none; }
.ma-account-channel, .ma-credit-channel { font-weight: 500; }
.ma-account-status, .ma-credit-value { color: var(--dsw-alias-label-secondary); }
`
  document.head.appendChild(style)
}
