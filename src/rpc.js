/**
 * Bridge to the vendored channel pack's Cordis services.
 *
 * The pack exposes one `accountPool` service, one auth service per provider
 * (`lobsteraiAuth`, `loomyAuth`, …) and a `credentials` service that resolves
 * a stored credential reference to its real value. This bridge calls those
 * services directly — there is no Remote/RPC channel in between.
 */
export const PACK_ENDPOINT = 'channel-pack'
const MESSAGE_CAP = 600
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

  /** Map a provider id to its auth service, handling the aliased providers. */
  function authOf(provider) {
    const svc = services?.(); if (!svc?.auth) return null
    return svc.auth.get(provider)
      ?? (provider === 'qodercn' ? svc.auth.get('qoder') : null)
      ?? (provider === 'minimaxintl' ? svc.auth.get('minimax') : null)
  }

  /** Resolve a stored account's real credential object. */
  async function credentialFor(entry) {
    const svc = services?.()
    const ref = entry?.credentialRef
    if (!ref || !svc?.credentials) return undefined
    try {
      const resolved = await svc.credentials.resolve(ref)
      if (!resolved?.value) return undefined
      const parsed = JSON.parse(resolved.value)
      return parsed && typeof parsed === 'object' ? parsed : undefined
    } catch {
      return undefined
    }
  }

  /** List accounts of one provider (the pool's `listAccounts(provider)`). */
  async function accountsOf(provider) {
    const svc = services?.()
    const pool = svc?.accountPool
    if (!pool) return []
    let rows = []
    if (provider && typeof pool.listAccounts === 'function') {
      rows = await pool.listAccounts(provider)
    } else if (typeof pool.listAllAccounts === 'function') {
      rows = await pool.listAllAccounts()
    }
    if (!Array.isArray(rows)) rows = []
    // Defensive: some pool builds ignore the provider argument and return
    // every account; re-filter so one channel never processes another's.
    if (provider) rows = rows.filter(a => a?.provider === provider)
    return rows
  }

  async function perform(method, payload) {
    const svc = services?.()
    if (!svc?.accountPool) return fail(RPC_CODES.PACK_UNAVAILABLE, 'channel pack is not mounted')
    const pool = svc.accountPool
    try {
      switch (method) {
        case 'account.list': {
          const accounts = await accountsOf(payload.provider)
          return { ok: true, value: accounts }
        }

        case 'account.create': {
          const auth = authOf(payload.provider)
          if (!auth || typeof auth.startLogin !== 'function')
            return fail(RPC_CODES.UPSTREAM, `no login for ${payload.provider}`)
          const flow = await auth.startLogin({})
          return { ok: true, value: flow ?? {} }
        }

        case 'login.poll': {
          const auth = authOf(payload.provider)
          if (!auth || typeof auth.status !== 'function')
            return fail(RPC_CODES.UPSTREAM, `no status for ${payload.provider}`)
          const status = await auth.status(payload.accountId)
          return { ok: true, value: status ?? {} }
        }

        case 'credits.balances': {
          const provider = payload.provider
          const auth = authOf(provider)
          const accounts = await accountsOf(provider)
          const balances = []
          for (const acc of accounts) {
            let bal = null
            try {
              if (auth && typeof auth.fetchCreditBalance === 'function') {
                const credential = await credentialFor(acc)
                if (credential) bal = await auth.fetchCreditBalance(credential)
              } else if (auth && typeof auth.fetchBalance === 'function') {
                bal = await auth.fetchBalance(acc.id ?? acc.accountId)
              }
            } catch {}
            balances.push({
              provider,
              accountId: acc.id ?? acc.accountId,
              nickname: acc.nickname ?? '',
              ...(typeof bal === 'object' && bal !== null ? bal : { balance: bal ?? acc.balance ?? 0 }),
            })
          }
          return { ok: true, value: balances }
        }

        case 'credits.claimAll': {
          const summary = await claimProvider(payload.provider)
          return { ok: true, value: { summary } }
        }

        case 'backup.export': {
          const all = typeof pool.listAllAccounts === 'function' ? await pool.listAllAccounts() : []
          return { ok: true, value: { exportedAt: new Date().toISOString(), accounts: all } }
        }

        default:
          return fail(RPC_CODES.BAD_RESPONSE, `unknown method: ${method}`)
      }
    } catch (error) {
      return fail(RPC_CODES.UPSTREAM, String(error?.message ?? error))
    }
  }

  /**
   * Claim every account of one provider and return a magpie-style summary:
   * `{ claimed, alreadyClaimed, inactive, failed, totalByUnit: { credit } }`.
   */
  async function claimProvider(provider) {
    const auth = authOf(provider)
    const accounts = await accountsOf(provider)
    const summary = { claimed: 0, alreadyClaimed: 0, inactive: 0, failed: 0, totalByUnit: { credit: 0, token: 0 }, lastError: '' }
    if (!auth) {
      summary.inactive = accounts.length
      return summary
    }

    for (const acc of accounts) {
      if (acc.enabled === false) { summary.inactive++; continue }
      try {
        const outcome = await claimOne(auth, provider, acc)
        classifyOutcome(outcome, summary)
      } catch (error) {
        summary.failed++
        summary.lastError = String(error?.message ?? error).slice(0, 200)
        warn?.(`bridge claim ${provider}/${acc.id}: ${summary.lastError}`)
      }
    }
    return summary
  }

  /** Call the provider-specific claim method for one account. */
  async function claimOne(auth, provider, acc) {
    const credential = await credentialFor(acc)
    if (!credential) return { kind: 'inactive', message: '凭证不可用' }

    // ZCode's claim endpoint always requires an Alibaba captcha. The auth
    // service mints one itself via a headless Chromium (mintCaptcha), so we
    // hand it a mint callback and use claimDailyFor (per-credential entry).
    if (provider === 'zcode' && typeof auth.claimDailyFor === 'function' && typeof auth.mintCaptcha === 'function') {
      const outcomes = await auth.claimDailyFor(credential, async config => auth.mintCaptcha(config))
      return Array.isArray(outcomes) ? outcomes[outcomes.length - 1] : outcomes
    }
    if (typeof auth.claimDailyQuota === 'function')
      return await auth.claimDailyQuota(credential)
    if (typeof auth.claimLoginReward === 'function')
      return await auth.claimLoginReward(credential)
    if (typeof auth.claimDaily === 'function')
      return await auth.claimDaily(credential)
    // No claim endpoint: refresh only, report inactive (nothing to claim).
    if (typeof auth.refresh === 'function') {
      try { await auth.refresh() } catch {}
    }
    return { kind: 'inactive', message: '该渠道无签到接口' }
  }

  /** Fold one claim outcome into the running summary. */
  function classifyOutcome(outcome, summary) {
    const kind = outcome?.kind ?? ''
    if (kind === 'claimed') {
      summary.claimed++
      const credit = Number(outcome.credit) || 0
      summary.totalByUnit.credit += credit
    } else if (kind === 'already-claimed') {
      summary.alreadyClaimed++
    } else if (kind === 'inactive') {
      summary.inactive++
    } else {
      summary.failed++
      if (outcome?.message) summary.lastError = String(outcome.message).slice(0, 200)
    }
  }

  function fail(code, message) {
    const text = cap(message)
    if (code !== RPC_CODES.PACK_UNAVAILABLE) warn?.(`bridge ${code}: ${text}`)
    return { ok: false, code, message: text }
  }

  return { call, available, PACK_ENDPOINT }
}

function cap(t) {
  const c = String(t).replace(/\s+/g, ' ').trim()
  return c.length > MESSAGE_CAP ? c.slice(0, MESSAGE_CAP - 1) + '…' : c
}

export function stableKey(v) {
  if (v === undefined) return ''
  return JSON.stringify(v, (_, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val))
      return Object.keys(val).sort().reduce((a, k) => { a[k] = val[k]; return a }, {})
    return val
  })
}
