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

import { buildRouteEntry } from './aggregate.js'
import { pickCandidate, fallbackOrder, hasFallback, DEFAULT_STRATEGY } from './policies.js'
import { matchRule, applyRule } from './rules.js'
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
   * @param {() => Record<string, {strategy?: string, pinned?: string[], enabled?: boolean, rules?: object[]}>} deps.routes route preferences
   * @param {(key: string) => object[]} [deps.rulesFor] rules attached to a route key
   * @param {() => Map<string, {avgLatency?: number, calls?: number, failures?: number}>} [deps.channelStats] live per-channel stats
   * @param {(entry: object, candidate: object) => void} [deps.onDispatch] usage hook
   * @param {(rec: {model: string, channel: string, latencyMs: number, promptTokens?: number, completionTokens?: number, success: boolean, error?: string}) => void} [deps.onComplete] per-call completion hook
   * @param {typeof console} [deps.logger]
   */
  constructor({ adapters, llm, routes, rulesFor, channelStats, onDispatch, onComplete, logger = console }) {
    this.adapters = adapters
    this.llm = llm
    this.routes = routes
    this.rulesFor = rulesFor
    this.channelStats = channelStats
    this.onDispatch = onDispatch
    this.onComplete = onComplete
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
        if (typeof adapter.listModels === 'function') {
          // Some channels (e.g. minimax) can block on a slow network fetch
          // with no timeout. One hung channel would freeze the whole route
          // table, so cap each listing; a channel that misses the window
          // simply contributes no candidates this round.
          const listing = Promise.resolve(adapter.listModels(channel))
          models = await Promise.race([
            listing,
            new Promise(resolve => setTimeout(() => resolve([]), 8000)),
          ])
        }
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
   * walks the candidates. Strategy + per-channel stats + rules decide the
   * starting candidate at stream time (when the request content is known);
   * the chosen candidate's own `prepareCall` is then reused verbatim,
   * wrapped by the zero-output failure switch.
   */
  async prepareCall(_provider, model, signal) {
    const key = stripPrefix(model)
    const entry = (await this.entries()).find(candidate => candidate.key === key)
    if (entry === undefined || entry.candidates.length === 0) {
      const error = new Error(`route: no candidates for "${key}"`)
      error.code = 'UNKNOWN_MODEL'
      throw error
    }
    // Per-call context carried through the fallback walk: start time, the
    // candidate currently serving, and any token usage parsed from chunks.
    const callCtx = {
      startedAt: Date.now(),
      index: 0,
      promptTokens: 0,
      completionTokens: 0,
    }
    return {
      // Model metadata is the route's own; the first visible chunk carries
      // the serving channel's real model.
      model: this.describeModel(entry),
      // Async generator (not an async function): the host iterates the
      // result directly, so calling stream(options) must itself be an async
      // iterable rather than a Promise of one.
      stream: async function* routeStream(options) {
        const order = this.resolveOrder(entry, options)
        const first = order[0]
        this.onDispatch?.(entry, first)
        let prepared
        try {
          prepared = await this.prepareCandidate(first, options.signal ?? signal)
        } catch (prepareError) {
          // The first candidate could not even be prepared: walk the rest.
          this.logger.warn?.(`route: ${first.channel} could not be prepared (${String(prepareError?.message ?? prepareError)})`)
          yield* this.streamFromOrder(entry, order, 1, options, prepareError, callCtx)
          return
        }
        yield* this.streamWithFallback(entry, order, options, prepared.stream, callCtx)
      }.bind(this),
    }
  }

  /** Describe the virtual model for the host catalog (same shape as listModels). */
  describeModel(entry) {
    return {
      provider: ROUTE_PROVIDER_ID,
      id: `${ROUTE_MODEL_PREFIX}${entry.key}`,
      name: `${entry.name} · ${entry.candidates.length} 渠道`,
      inputModalities: entry.inputModalities,
      ...entry.contextWindow === undefined ? {} : { context: { contextWindow: entry.contextWindow } },
      ...entry.maxTokens === undefined ? {} : { defaultMaxTokens: entry.maxTokens },
    }
  }

  /**
   * Resolve the candidate order for one turn.
   *
   * 1. Strategy picks the head, using live per-channel stats (fast sorts by
   *    latency; usage/weight/pace read quota stats when available).
   * 2. The rest follow in fallback order.
   * 3. Rules are evaluated top-down against the request; the first match
   *    pins its target channel to the front (magpie behavior).
   */
  resolveOrder(entry, options) {
    const stats = this.channelStats?.() ?? new Map()
    const head = pickCandidate(entry, { stats, timestamp: Date.now() })
    if (head === undefined) return []
    let order = [head, ...fallbackOrder(entry, head.channel).filter(candidate => candidate !== head)]
    const rules = this.rulesFor?.(entry.key) ?? []
    if (rules.length > 0) {
      const matched = matchRule(rules, this.ruleContext(options))
      if (matched) order = applyRule(order, matched)
    }
    return order
  }

  /** Build the rule-engine context from a request (tokens/images/reasoning). */
  ruleContext(options) {
    const messages = options?.messages ?? []
    let hasImages = false
    let chars = 0
    for (const message of messages) {
      const content = message?.content
      const blocks = Array.isArray(content) ? content : [{ type: 'text', text: String(content ?? '') }]
      for (const block of blocks) {
        if (block?.type === 'image') hasImages = true
        if (typeof block?.text === 'string') chars += block.text.length
      }
    }
    return {
      // Rough estimate: ~4 chars per token; enough for threshold rules.
      tokens: Math.ceil(chars / 4),
      hasImages,
      reasoning: options?.reasoning !== undefined || options?.thinking !== undefined || options?.reasoningEffort !== undefined,
      now: new Date(),
    }
  }

  /**
   * Start the fallback walk from a candidate other than the first (used when
   * the head could not even be prepared). Yields a generator that prepares
   * each subsequent candidate in turn.
   */
  async *streamFromOrder(entry, order, startIndex, options, firstError, callCtx) {
    let index = startIndex
    let lastError = firstError
    while (index < order.length) {
      const candidate = order[index]
      callCtx.index = index
      try {
        const prepared = await this.prepareCandidate(candidate, options.signal)
        this.onDispatch?.(entry, candidate)
        yield* this.streamWithFallback(entry, order, options, prepared.stream, callCtx, index)
        return
      } catch (error) {
        lastError = error
        this.logger.warn?.(`route: ${candidate.channel} failed to prepare (${String(error?.message ?? error)})`)
        index += 1
      }
    }
    throw lastError
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
  async *streamWithFallback(entry, order, options, firstStreamFactory, callCtx, startIndex = 0) {
    let index = startIndex
    // Adapters do not all close over the model: some read it from the stream
    // options (e.g. lobsterai uses options.model). The route's own options
    // carry the virtual "route:..." model, so before dispatching a candidate
    // we rewrite provider/model to that candidate's real channel and model.
    const candidateOptions = i => ({ ...options, provider: order[i].channel, model: order[i].model })
    let stream = typeof firstStreamFactory === 'function' ? firstStreamFactory(candidateOptions(index)) : firstStreamFactory
    /** @type {any[]} non-visible chunks of the current candidate */
    let pending = []
    let produced = false
    const finish = (success, error) => {
      const candidate = order[index]
      this.onComplete?.({
        model: entry.key,
        channel: candidate?.channel ?? '',
        latencyMs: Date.now() - callCtx.startedAt,
        promptTokens: callCtx.promptTokens,
        completionTokens: callCtx.completionTokens,
        success,
        ...error ? { error: String(error?.message ?? error).slice(0, 120) } : {},
      })
    }
    for (;;) {
      try {
        for await (const chunk of stream) {
          collectUsage(chunk, callCtx)
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
        finish(true)
        return
      } catch (error) {
        const candidate = order[index]
        const next = order[index + 1]
        // Visible output already went out, or there is nowhere to go: the
        // failure is the user's to see.
        if (produced || next === undefined || !hasFallback(entry, candidate?.channel)) {
          finish(false, error)
          throw error
        }
        this.logger.warn?.(
          `route: "${entry.key}" failed on ${candidate?.channel} before any output; switching to ${next.channel}`,
        )
        index += 1
        callCtx.index = index
        pending = []
        try {
          const prepared = await this.prepareCandidate(next, options.signal)
          this.onDispatch?.(entry, next)
          stream = prepared.stream(candidateOptions(index))
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
 * Parse token usage out of a stream chunk when the channel reports it.
 * Different vocabularies (Anthropic/OpenAI-style) are tolerated; fields that
 * are absent simply leave the running totals unchanged.
 *
 * @param {any} chunk
 * @param {{promptTokens: number, completionTokens: number}} callCtx
 */
function collectUsage(chunk, callCtx) {
  if (chunk === null || typeof chunk !== 'object') return
  const usage = chunk.usage ?? chunk.usageMetadata ?? chunk.tokenUsage
  if (usage && typeof usage === 'object') {
    const prompt = Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokens ?? usage.inputTokens ?? 0)
    const completion = Number(usage.output_tokens ?? usage.completion_tokens ?? usage.completionTokens ?? usage.outputTokens ?? 0)
    if (Number.isFinite(prompt) && prompt > 0) callCtx.promptTokens = prompt
    if (Number.isFinite(completion) && completion > 0) callCtx.completionTokens = completion
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
