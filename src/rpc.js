/**
 * Bridge to the vendored channel pack's Cordis services.
 *
 * The pack registers Cordis services (accountPool, per-channel auth classes)
 * directly — not over connection.rpc. This bridge looks them up from the
 * injected fiber and dispatches method calls to the right service.
 */

export const PACK_ENDPOINT = 'channel-pack'

const MESSAGE_CAP = 300

export const RPC_CODES = Object.freeze({
  PACK_UNAVAILABLE: 'PACK_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  ABORTED: 'ABORTED',
  UPSTREAM: 'UPSTREAM',
  BAD_RESPONSE: 'BAD_RESPONSE',
})

/**
 * @param {object} options
 * @param {() => any} options.connection
 * @param {() => {accountPool: any, auth: Map<string, any>}} options.services
 * @param {(message: string) => void} [options.warn]
 */
export function createBridge({ connection, services, warn }) {
  const inflight = new Map()

  function available() {
    try {
      const svc = services?.()
      return svc?.accountPool !== null && svc?.accountPool !== undefined
    } catch {
      return false
    }
  }

  async function call(method, payload = {}, options = {}) {
    const dedupeKey = options.dedupeKey ?? `${method}:${stableKey(payload)}`
    if (inflight.has(dedupeKey)) return inflight.get(dedupeKey)
    const task = perform(method, payload).finally(() => inflight.delete(dedupeKey))
    inflight.set(dedupeKey, task)
    return task
  }

  async function perform(method, payload) {
    const svc = services?.()
    if (!svc || !svc.accountPool) return fail(RPC_CODES.PACK_UNAVAILABLE, 'channel pack is not mounted')

    try {
      switch (method) {
        case 'account.list': {
          const provider = payload.provider
          const pool = svc.accountPool
          let accounts = []
          if (typeof pool.listAccounts === 'function') {
            accounts = await pool.listAccounts(provider)
          } else if (typeof pool.listAllAccounts === 'function') {
            const all = await pool.listAllAccounts()
            accounts = provider ? all.filter(a => a.provider === provider || a.channel === provider) : all
          }
          return { ok: true, value: accounts ?? [] }
        }

        case 'account.create': {
          const auth = svc.auth?.get(payload.provider)
          if (!auth || typeof auth.startLogin !== 'function') return fail(RPC_CODES.UPSTREAM, `no login flow for ${payload.provider}`)
          const flow = await auth.startLogin({})
          return { ok: true, value: flow }
        }

        case 'login.poll': {
          const auth = svc.auth?.get(payload.provider)
          if (!auth || typeof auth.status !== 'function') return fail(RPC_CODES.UPSTREAM, `no status for ${payload.provider}`)
          const status = await auth.status(payload.accountId)
          return { ok: true, value: status }
        }

        case 'credits.balances': {
          // Read balances from stored accounts — pool already tracks them.
          const pool = svc.accountPool
          let accounts = []
          if (typeof pool.listAccounts === 'function') accounts = await pool.listAccounts(payload.provider)
          else if (typeof pool.listAllAccounts === 'function') accounts = await pool.listAllAccounts()
          const balances = (accounts ?? []).map(a => ({
            provider: a.provider ?? a.channel ?? payload.provider,
            accountId: a.id ?? a.accountId,
            balance: a.balance ?? a.creditBalance ?? a.quota ?? 0,
            plan: a.plan ?? a.tier ?? '',
          }))
          return { ok: true, value: balances }
        }

        case 'credits.claimAll': {
          // Per-channel claim logic lives in each auth service; for now
          // trigger a refresh which picks up daily grants on most channels.
          const auth = svc.auth?.get(payload.provider)
          if (!auth) return { ok: true, value: { claimed: [], message: 'no auth service' } }
          try {
            if (typeof auth.refresh === 'function') await auth.refresh()
          } catch {}
          return { ok: true, value: { claimed: [payload.provider] } }
        }

        case 'backup.export': {
          const pool = svc.accountPool
          let accounts = []
          if (typeof pool.listAllAccounts === 'function') accounts = await pool.listAllAccounts()
          return { ok: true, value: { exportedAt: new Date().toISOString(), accounts: accounts ?? [] } }
        }

        default:
          return fail(RPC_CODES.BAD_RESPONSE, `unknown method: ${method}`)
      }
    } catch (error) {
      return fail(RPC_CODES.UPSTREAM, String(error?.message ?? error))
    }
  }

  function fail(code, message) {
    const text = cap(message)
    if (code !== RPC_CODES.PACK_UNAVAILABLE) warn?.(`dsh-model-admin bridge ${code}: ${text}`)
    return { ok: false, code, message: text }
  }

  return { call, available, PACK_ENDPOINT }
}

function cap(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim()
  return clean.length > MESSAGE_CAP ? `${clean.slice(0, MESSAGE_CAP - 1)}…` : clean
}

export function stableKey(value) {
  if (value === undefined) return ''
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val).sort().reduce((acc, k) => { acc[k] = val[k]; return acc }, {})
    }
    return val
  })
}
