/**
 * The routing provider — one virtual provider whose models are the union of
 * every channel's models, grouped by canonical name.
 *
 * Architecture note (why this shape):
 *
 * The channel adapters are created inside the vendored pack's own closure
 * and the host's llm service exposes no adapter-level forward — so the route
 * cannot call a channel adapter through any public API. What it CAN do is
 * observe registrations: the pack calls `ctx.llm.registerAdapter([...],
 * adapter)` while mounting, and this module wraps that call BEFORE the pack
 * mounts, keeping every adapter the host ends up with. The route then
 * reuses each channel's own `prepareCall` — its auth, account pool, rate-
 * limit rotation and wire protocol all stay the channel's business; the
 * route only chooses candidates and moves on after a zero-output failure.
 *
 * Failure switching is deliberately narrow: a candidate that already
 * streamed visible output is never abandoned (output cannot be retracted,
 * and splicing a second candidate's answer would produce a malformed turn).
 * A candidate that failed before producing anything is the only case the
 * route moves past.
 *
 * Catalog note: `listModels` reads the captured adapters' own listings and
 * groups them, so a channel the user has not signed into simply contributes
 * no candidates. Capacity fields are the intersection across candidates —
 * an image-capable head must not make the route advertise vision for a
 * text-only fallback.
 */

import { buildRouteEntry, pickCandidate, fallbackOrder, hasFallback, DEFAULT_STRATEGY } from './aggregate.js'
import { groupByCanonical } from './normalize.js'

/** Provider id the route registers under; also the picker's group name. */
export const ROUTE_PROVIDER_ID = 'dsh-model-admin-route'

/** Prefix that marks a virtual route model id in the picker. */
export const ROUTE_MODEL_PREFIX = 'route:'

/**
 * Wrap `ctx.llm.registerAdapter` so every adapter the host registers is
 * captured. Installed before the channel pack mounts; harmless when no pack
 * is present (the map simply stays empty and the route offers nothing).
 *
 * @param {any} ctx cordis context
 * @param {Map<string, any>} captured adapter map, mutated in place
 */
export function captureAdapters(ctx, captured) {
  try {
    const llm = ctx.llm ?? ctx.get?.('llm')
    if (llm === undefined || typeof llm.registerAdapter !== 'function') return () => {}
    const original = llm.registerAdapter.bind(llm)
    llm.registerAdapter = (providers, adapter) => {
      for (const provider of providers ?? []) {
        if (typeof provider === 'string' && provider.length > 0 && provider !== ROUTE_PROVIDER_ID) {
          captured.set(provider, adapter)
        }
      }
      return original(providers, adapter)
    }
    return () => {
      try { llm.registerAdapter = original } catch {}
    }
  } catch {
    // The host may freeze the llm service or define registerAdapter as a
    // non-writable property. Without monkey-patching we simply miss the
    // channel adapters — the route lane stays empty — instead of crashing
    // the whole plugin (and its HTTP console) on apply.
    return () => {}
  }
}

/**
 * The routing adapter: the LlmAdapter shape the host expects
 * (`providerInfo` / `listModels` / `resolveModel` / `prepareCall` /
 * `providerRetryPolicy`), implemented over the captured channel adapters.
 */
export class RouteAdapter {
  /**
   * @param {object} deps
   * @param {() => Map<string, any>} deps.adapters captured channel adapters
   * @param {() => any} deps.llm the llm service, for retry policy passthrough
   * @param {() => Record<string, {strategy?: string, pinned?: string[], enabled?: boolean}>} deps.routes route preferences
   * @param {(entry: object, candidate: object) => void} [deps.onDispatch] usage hook
   * @param {typeof console} [deps.logger]
   */
  constructor({ adapters, llm, routes, onDispatch, logger = console }) {
    this.adapters = adapters
    this.llm = llm
    this.routes = routes
    this.onDispatch = onDispatch
    this.logger = logger
    /** @type {object[] | undefined} rebuilt by refresh() */
    this.cached = undefined
    this.refreshedAt = 0
  }

  providerInfo(_provider) {
    return { id: ROUTE_PROVIDER_ID, name: 'Model Admin 路由' }
  }

  async providerRetryPolicy(provider) {
    // Inherit the first candidate channel's policy: the route's retry
    // behaviour should match whatever it is about to talk to.
    const entries = await this.entries()
    const entry = entries.find(candidate => candidate.key === stripPrefix(provider))
    const channel = entry?.candidates[0]?.channel
    const adapter = channel === undefined ? undefined : this.adapters().get(channel)
    return adapter?.providerRetryPolicy?.(channel)
  }

  /**
   * Refresh the channel catalogs and rebuild the route table.
   *
   * The host's adapter contract makes `listModels` async, so the route
   * keeps a cache: `refresh()` awaits every captured channel and rebuilds
   * the entries; the synchronous readers (`providerRetryPolicy`,
   * `routeEntries`) read the cache. A first call before any refresh sees an
   * empty table, which is why every public method refreshes first.
   */
  async refresh() {
    const rows = []
    for (const [channel, adapter] of this.adapters()) {
      if (channel === ROUTE_PROVIDER_ID) continue
      let models = []
      try {
        models = typeof adapter.listModels === 'function' ? await adapter.listModels(channel) : []
      } catch {
        models = []
      }
      for (const model of models ?? []) {
        rows.push({
          provider: channel,
          id: String(model?.id ?? ''),
          name: model?.name === undefined ? undefined : String(model.name),
          contextWindow: model?.contextWindow ?? model?.context?.contextWindow,
          maxTokens: model?.defaultMaxTokens ?? model?.maxTokens,
          inputModalities: model?.inputModalities,
        })
      }
    }
    const prefs = this.routes()
    const entries = []
    for (const [key, bucket] of groupByCanonical(rows)) {
      const pref = prefs[key] ?? {}
      if (pref.enabled === false) continue
      entries.push(buildRouteEntry(key, bucket, { strategy: pref.strategy ?? DEFAULT_STRATEGY, pinned: pref.pinned }))
    }
    this.cached = entries
    this.refreshedAt = Date.now()
    return entries
  }

  /** Every route entry from the cache, refreshed at most `ttlMs` ago. */
  async entries(ttlMs = 5_000) {
    const now = Date.now()
    if (this.cached === undefined || now - this.refreshedAt > ttlMs) await this.refresh()
    return this.cached ?? []
  }

  /** Synchronous cache read for callers that cannot await. */
  routeEntries() {
    return this.cached ?? []
  }

  async listModels(_provider) {
    const entries = await this.entries()
    const listed = []
    for (const entry of entries) {
      if (entry.candidates.length === 0) continue
      listed.push({
        provider: ROUTE_PROVIDER_ID,
        id: `${ROUTE_MODEL_PREFIX}${entry.key}`,
        name: `${entry.name} · ${entry.candidates.length} 渠道`,
        description: entry.candidates.map(c => c.channel).join(' / '),
        inputModalities: entry.inputModalities,
        ...entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow },
        ...entry.maxTokens === undefined ? {} : { defaultMaxTokens: entry.maxTokens },
      })
    }
    return listed
  }

  async resolveModel(provider, model, signal) {
    const key = stripPrefix(model)
    const entry = (await this.entries()).find(candidate => candidate.key === key)
    if (entry === undefined) {
      const error = new Error(`route: no candidates for "${key}"`)
      error.code = 'UNKNOWN_MODEL'
      throw error
    }
    return {
      provider,
      id: model,
      name: `${entry.name} · ${entry.candidates.length} 渠道`,
      inputModalities: entry.inputModalities,
      ...entry.contextWindow === undefined ? {} : { context: { contextWindow: entry.contextWindow } },
      ...entry.maxTokens === undefined ? {} : { defaultMaxTokens: entry.maxTokens },
    }
  }

  /**
   * Prepare one turn: resolve the entry, then hand the host a stream that
   * walks the candidates. The first candidate's own `prepareCall` result is
   * reused verbatim (its model info and stream are the channel's), wrapped
   * only by the zero-output failure switch.
   */
  async prepareCall(_provider, model, signal) {
    const key = stripPrefix(model)
    const entry = (await this.entries()).find(candidate => candidate.key === key)
    if (entry === undefined || entry.candidates.length === 0) {
      const error = new Error(`route: no candidates for "${key}"`)
      error.code = 'UNKNOWN_MODEL'
      throw error
    }
    const order = this.orderFor(entry)
    const first = order[0]
    this.onDispatch?.(entry, first)
    const prepared = await this.prepareCandidate(first, signal)
    return {
      model: prepared.model,
      stream: options => this.streamWithFallback(entry, order, options, prepared.stream),
    }
  }

  /** First candidate + the rest, in the order a failure would walk them. */
  orderFor(entry) {
    const head = pickCandidate(entry)
    if (head === undefined) return []
    const rest = fallbackOrder(entry, head.channel)
    return [head, ...rest.filter(candidate => candidate !== head)]
  }

  async prepareCandidate(candidate, signal) {
    const adapter = this.adapters().get(candidate.channel)
    if (adapter === undefined || typeof adapter.prepareCall !== 'function') {
      const error = new Error(`route: channel "${candidate.channel}" has no adapter`)
      error.code = 'UNKNOWN_MODEL'
      throw error
    }
    return adapter.prepareCall(candidate.channel, candidate.model, signal)
  }

  /**
   * The zero-output failure switch.
   *
   * `firstStreamFactory` is the first candidate's stream factory. This
   * wrapper forwards every chunk; the moment the candidate fails BEFORE any
   * visible content, the next candidate takes over from the start (messages
   * are replayed by the caller's options, so a fresh generator is all that
   * is needed). Once anything visible has been yielded, a later failure is
   * the user's turn to see — no silent splice.
   *
   * Non-visible chunks (reasoning, tool plumbing) are BUFFERED, not
   * forwarded immediately: if the candidate then fails, its half-finished
   * reasoning must not appear beside the next candidate's answer. A
   * candidate that completes releases its buffer first, in order.
   */
  async *streamWithFallback(entry, order, options, firstStreamFactory) {
    let index = 0
    let stream = typeof firstStreamFactory === 'function' ? firstStreamFactory(options) : firstStreamFactory
    /** @type {any[]} non-visible chunks of the current candidate */
    let pending = []
    let produced = false
    for (;;) {
      try {
        for await (const chunk of stream) {
          if (isVisibleChunk(chunk)) {
            for (const buffered of pending) yield buffered
            pending = []
            produced = true
            yield chunk
          } else {
            pending.push(chunk)
          }
        }
        // The candidate finished: flush whatever it buffered.
        for (const buffered of pending) yield buffered
        return
      } catch (error) {
        const candidate = order[index]
        const next = order[index + 1]
        // Visible output already went out, or there is nowhere to go: the
        // failure is the user's to see.
        if (produced || next === undefined || !hasFallback(entry, candidate?.channel)) throw error
        this.logger.warn?.(
          `route: "${entry.key}" failed on ${candidate?.channel} before any output; switching to ${next.channel}`,
        )
        index += 1
        pending = []
        try {
          const prepared = await this.prepareCandidate(next, options.signal)
          this.onDispatch?.(entry, next)
          stream = prepared.stream(options)
        } catch (prepareError) {
          // The next candidate could not even be prepared: keep walking.
          this.logger.warn?.(`route: ${next.channel} could not be prepared (${String(prepareError?.message ?? prepareError)})`)
          stream = (async function* failed() { throw prepareError })()
        }
      }
    }
  }
}

/**
 * Whether a chunk carries user-visible content. Reasoning deltas and tool
 * plumbing are not visible: a candidate that streamed only reasoning before
 * failing can still be retried on the next candidate without the user
 * having seen an answer.
 *
 * @param {any} chunk
 * @returns {boolean}
 */
export function isVisibleChunk(chunk) {
  if (chunk === null || typeof chunk !== 'object') return chunk !== undefined && chunk !== null
  const type = String(chunk.type ?? '')
  if (type === 'text' || type === 'content' || type === 'text-delta' || type === 'output_text') return true
  if (type === 'reasoning' || type === 'reasoning-delta' || type === 'tool-call' || type === 'tool_call') return false
  if (typeof chunk.text === 'string' && chunk.text.length > 0) return true
  if (typeof chunk.delta === 'string' && chunk.delta.length > 0) return true
  if (typeof chunk.content === 'string' && chunk.content.length > 0) return true
  return false
}

function stripPrefix(model) {
  const text = String(model ?? '')
  return text.startsWith(ROUTE_MODEL_PREFIX) ? text.slice(ROUTE_MODEL_PREFIX.length) : text
}
