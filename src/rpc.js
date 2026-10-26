/**
 * The RPC bridge — the only place this plugin touches the vendored channel
 * pack. Every call goes out as
 * `connection.rpc.call('/api', 'channel-pack', { method, payload }, signal)`
 * and comes back as `{ ok: true, value }` or `{ ok: false, error }`.
 *
 * Two rules live here so no caller re-implements them:
 *
 * 1. **Errors are normalized, never re-thrown raw.** A pack failure becomes
 *    `{ ok: false, code, message }`; the message is capped so a stack trace or
 *    an upstream HTML body cannot reach the panel.
 * 2. **A missing transport degrades, it does not throw.** When the pack is
 *    not mounted (headless composition, pack failed to load) every method
 *    answers `{ ok: false, code: 'PACK_UNAVAILABLE' }`, and the panel shows
 *    the reason instead of an empty list that looks like "no accounts".
 */

/** RPC endpoint name the pack registered under the connection service. */
export const PACK_ENDPOINT = 'channel-pack'

/** Max characters of an upstream error message we forward to the UI. */
const MESSAGE_CAP = 300

/** Stable error codes the panel branches on. */
export const RPC_CODES = Object.freeze({
  PACK_UNAVAILABLE: 'PACK_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  ABORTED: 'ABORTED',
  UPSTREAM: 'UPSTREAM',
  BAD_RESPONSE: 'BAD_RESPONSE',
})

/**
 * Build a bridge over one connection service.
 *
 * @param {object} options
 * @param {() => any} options.connection reads the current connection service;
 *   may return null/undefined while the host is still composing.
 * @param {(message: string) => void} [options.warn] diagnostics sink
 * @param {typeof fetch} [options.fetchImpl] unused today; kept so tests can
 *   construct the bridge without a live host.
 * @returns {Bridge}
 */
export function createBridge({ connection, warn }) {
  /** In-flight method+key dedupe: the panel double-fires on mount. */
  const inflight = new Map()

  const transport = () => {
    try {
      const current = connection?.()
      const call = current?.rpc?.call
      if (typeof call !== 'function') return null
      return { connection: current, call }
    } catch {
      return null
    }
  }

  /**
   * Call one pack method.
   * @param {string} method e.g. 'account.list'
   * @param {object} [payload]
   * @param {{timeoutMs?: number, signal?: AbortSignal, dedupeKey?: string}} [options]
   * @returns {Promise<{ok: true, value: any} | {ok: false, code: string, message: string}>}
   */
  async function call(method, payload, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : 60_000
    const dedupeKey = options.dedupeKey ?? `${method}:${stableKey(payload)}`

    if (inflight.has(dedupeKey)) return inflight.get(dedupeKey)

    const task = perform(method, payload, timeoutMs, options.signal)
      .finally(() => inflight.delete(dedupeKey))
    inflight.set(dedupeKey, task)
    return task
  }

  async function perform(method, payload, timeoutMs, signal) {
    const t = transport()
    if (t === null) return fail(RPC_CODES.PACK_UNAVAILABLE, 'channel pack is not mounted')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = () => controller.abort()
    if (signal !== undefined) {
      if (signal.aborted) {
        clearTimeout(timer)
        return fail(RPC_CODES.ABORTED, 'aborted before dispatch')
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    try {
      const result = await t.call.call(t.connection.rpc, '/api', PACK_ENDPOINT, { method, payload }, controller.signal)
      return normalize(method, result)
    } catch (error) {
      if (signal?.aborted === true) return fail(RPC_CODES.ABORTED, 'aborted')
      if (controller.signal.aborted === true) return fail(RPC_CODES.TIMEOUT, `${method} timed out after ${timeoutMs}ms`)
      return fail(RPC_CODES.UPSTREAM, String(error?.message ?? error))
    } finally {
      clearTimeout(timer)
      if (signal !== undefined) signal.removeEventListener('abort', onAbort)
    }
  }

  function normalize(method, result) {
    if (result === null || typeof result !== 'object') {
      return fail(RPC_CODES.BAD_RESPONSE, `${method}: malformed response`)
    }
    if (result.ok === true) return { ok: true, value: result.value }
    if (result.ok === false) {
      const message = result.error?.message ?? result.error?.code ?? 'rpc failed'
      return fail(RPC_CODES.UPSTREAM, cap(String(message)))
    }
    // A pack method that answers with a bare value (no envelope).
    return { ok: true, value: result }
  }

  function fail(code, message) {
    const text = cap(message)
    if (code !== RPC_CODES.PACK_UNAVAILABLE) warn?.(`dsh-model-admin rpc ${code}: ${text}`)
    return { ok: false, code, message: text }
  }

  /** Whether the pack is reachable right now (for the panel's banner). */
  function available() {
    return transport() !== null
  }

  return { call, available, PACK_ENDPOINT }
}

function cap(text) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > MESSAGE_CAP ? `${clean.slice(0, MESSAGE_CAP - 1)}…` : clean
}

/**
 * Deterministic payload key for dedupe. Object key order must not matter:
 * the panel rebuilds the same payload from the same state on every render.
 */
export function stableKey(value) {
  if (value === undefined) return ''
  return JSON.stringify(value, (_key, val) => {
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val).sort().reduce((acc, k) => {
        acc[k] = val[k]
        return acc
      }, {})
    }
    return val
  })
}
