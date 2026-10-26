/**
 * Model Admin — console entry (browser half).
 *
 * Registers one settings panel with four sections: Accounts (per-channel
 * account management), Check-in (the daily run, its schedule and history),
 * Credits (balances across channels, expiring packs first) and Backup
 * (credential export/import).
 *
 * The panel never talks to the channel pack directly: every call goes
 * through the plugin's own `/api/dsh-model-admin` route, so the browser half
 * has exactly one endpoint and one error envelope to handle. When the pack
 * is not mounted the route says so, and the panel shows the reason instead
 * of empty lists.
 */

// The panel lives in its own module so this entry stays a thin wiring layer.
import { createPanel } from './src/client/panel.js'

/** Route the host half serves. */
export const API_PATH = '/api/dsh-model-admin'

/** Default per-call timeout; claim runs may take a while upstream. */
const DEFAULT_TIMEOUT_MS = 60_000
const CLAIM_TIMEOUT_MS = 120_000

/**
 * The console's transport. Re-reads the connection service on every call
 * because the host composes services asynchronously — a client module that
 * captured `ctx.connection` at import time would hold a stale reference.
 */
export function createApiClient(getConnection) {
  async function call(method, payload, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const connection = readConnection(getConnection)
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

function readConnection(getConnection) {
  try {
    const connection = typeof getConnection === 'function' ? getConnection() : getConnection
    return connection ?? null
  } catch {
    return null
  }
}

/**
 * cordis client plugin: mount the panel into the settings surface.
 *
 * `inject` lists only the UI services this half renders through. The host
 * serves the panel under the Loader entry id, so a composition that never
 * loads this bundle simply never shows the tab.
 */
export function apply(ctx) {
  const client = createApiClient(() => {
    try {
      return ctx.connection ?? ctx.get?.('connection') ?? null
    } catch {
      return null
    }
  })

  const locale = ctx.locale?.bind?.('modelAdmin') ?? ((key) => key)

  ctx.effect(() => {
    const slots = ctx.get?.('slots')
    const settings = ctx.get?.('settings')
    if (slots === undefined || settings === undefined) return () => {}

    const panel = createPanel({ client, t: locale })
    const dispose = slots.mount('settings.plugins', panel)
    return () => {
      dispose?.()
    }
  }, 'dsh-model-admin: console')

  return { apiPath: API_PATH }
}

export default apply
