/**
 * Bridge to the vendored channel pack's Cordis services.
 */
export const PACK_ENDPOINT = 'channel-pack'
const MESSAGE_CAP = 300
export const RPC_CODES = Object.freeze({
  PACK_UNAVAILABLE: 'PACK_UNAVAILABLE', TIMEOUT: 'TIMEOUT', ABORTED: 'ABORTED',
  UPSTREAM: 'UPSTREAM', BAD_RESPONSE: 'BAD_RESPONSE',
})

export function createBridge({ services, warn }) {
  const inflight = new Map()
  function available() {
    try { const svc = services?.(); return svc?.accountPool != null } catch { return false }
  }
  async function call(method, payload = {}, options = {}) {
    const key = options.dedupeKey ?? `${method}:${stableKey(payload)}`
    if (inflight.has(key)) return inflight.get(key)
    const task = perform(method, payload).finally(() => inflight.delete(key))
    inflight.set(key, task)
    return task
  }
  function authOf(provider) {
    const svc = services?.(); if (!svc?.auth) return null
    return svc.auth.get(provider)
      ?? (provider === 'qodercn' ? svc.auth.get('qoder') : null)
      ?? (provider === 'minimaxintl' ? svc.auth.get('minimax') : null)
  }
  async function perform(method, payload) {
    const svc = services?.()
    if (!svc?.accountPool) return fail(RPC_CODES.PACK_UNAVAILABLE, 'channel pack is not mounted')
    const pool = svc.accountPool
    try {
      switch (method) {
        case 'account.list': {
          let accounts
          if (payload.provider && typeof pool.listAccountsByProvider === 'function')
            accounts = await pool.listAccountsByProvider(payload.provider)
          else if (typeof pool.listAllAccounts === 'function')
            accounts = await pool.listAllAccounts()
          else accounts = await pool.listAccounts?.() ?? []
          return { ok: true, value: accounts ?? [] }
        }
        case 'account.create': {
          const auth = authOf(payload.provider)
          if (!auth || typeof auth.startLogin !== 'function') return fail(RPC_CODES.UPSTREAM, `no login for ${payload.provider}`)
          const flow = await auth.startLogin({})
          return { ok: true, value: flow ?? {} }
        }
        case 'login.poll': {
          const auth = authOf(payload.provider)
          if (!auth || typeof auth.status !== 'function') return fail(RPC_CODES.UPSTREAM, `no status for ${payload.provider}`)
          const status = await auth.status(payload.accountId)
          return { ok: true, value: status ?? {} }
        }
        case 'credits.balances': {
          const auth = authOf(payload.provider)
          const accounts = typeof pool.listAccountsByProvider === 'function'
            ? await pool.listAccountsByProvider(payload.provider) : []
          const balances = []
          for (const acc of accounts) {
            let bal = null
            try {
              if (auth && typeof auth.fetchCreditBalance === 'function') bal = await auth.fetchCreditBalance(acc.credential ?? acc)
              else if (auth && typeof auth.fetchBalance === 'function') bal = await auth.fetchBalance(acc.id ?? acc.accountId)
            } catch {}
            balances.push({
              provider: payload.provider, accountId: acc.id ?? acc.accountId,
              ...(typeof bal === 'object' && bal !== null ? bal : { balance: bal ?? acc.balance ?? 0 }),
            })
          }
          return { ok: true, value: balances }
        }
        case 'credits.claimAll': {
          const auth = authOf(payload.provider)
          if (!auth) return { ok: true, value: { claimed: [] } }
          const results = []
          try {
            if (typeof auth.claimDailyQuota === 'function') { await auth.claimDailyQuota(); results.push({ ok: true, method: 'claimDailyQuota' }) }
            else if (typeof auth.claimLoginReward === 'function') { await auth.claimLoginReward(); results.push({ ok: true, method: 'claimLoginReward' }) }
            else if (typeof auth.claimDaily === 'function') { await auth.claimDaily(); results.push({ ok: true, method: 'claimDaily' }) }
            else if (typeof auth.refresh === 'function') { await auth.refresh(); results.push({ ok: true, method: 'refresh' }) }
          } catch (e) { results.push({ ok: false, error: String(e?.message ?? e) }) }
          return { ok: true, value: { claimed: results } }
        }
        case 'backup.export': {
          const all = typeof pool.listAllAccounts === 'function' ? await pool.listAllAccounts() : []
          return { ok: true, value: { exportedAt: new Date().toISOString(), accounts: all } }
        }
        default: return fail(RPC_CODES.BAD_RESPONSE, `unknown method: ${method}`)
      }
    } catch (error) { return fail(RPC_CODES.UPSTREAM, String(error?.message ?? error)) }
  }
  function fail(code, message) {
    const text = cap(message)
    if (code !== RPC_CODES.PACK_UNAVAILABLE) warn?.(`bridge ${code}: ${text}`)
    return { ok: false, code, message: text }
  }
  return { call, available, PACK_ENDPOINT }
}
function cap(t) { const c = String(t).replace(/\s+/g,' ').trim(); return c.length > MESSAGE_CAP ? c.slice(0,MESSAGE_CAP-1)+'…' : c }
export function stableKey(v) {
  if (v === undefined) return ''
  return JSON.stringify(v, (_, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val))
      return Object.keys(val).sort().reduce((a,k)=>{a[k]=val[k];return a},{})
    return val
  })
}