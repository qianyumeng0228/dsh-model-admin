/**
 * Aggregate routing — candidates, strategy, capacity intersection.
 *
 * One virtual catalog entry per canonical model; its candidates are the
 * channels that list a model under that key. A turn is sent to the first
 * candidate the strategy picks, and only when that candidate produced no
 * visible output does the route move to the next one (output already
 * streamed cannot be retracted — switching mid-stream would splice a
 * malformed answer).
 *
 * Two invariants from the ecosystem's own scars, kept here on purpose:
 *
 * 1. **Capacities are the intersection, not the union.** A candidate list
 *    that advertises vision because its head supports it hands a fallback an
 *    image it cannot read; a 1M window because its head has one overruns a
 *    128K fallback. The honest numbers are the ones every candidate honours.
 * 2. **A candidate order the user dragged is strict.** Manual pinning must
 *    not be silently overridden by an automatic score.
 */

import { canonicalModelKey, canonicalDisplayName } from './normalize.js'
import { STRATEGIES, DEFAULT_STRATEGY } from './policies.js'

export { STRATEGIES, DEFAULT_STRATEGY }
// The strategy machinery (pickCandidate, fallbackOrder, hasFallback,
// resetRotation) lives in policies.js — the magpie-style policies moved
// there. Re-export so callers and tests keep one import surface.
export { pickCandidate, fallbackOrder, hasFallback, resetRotation } from './policies.js'

/**
 * @typedef {object} Candidate
 * @property {string} channel provider id that lists the model
 * @property {string} model the raw model id on that channel
 * @property {string} [name] display name on that channel
 * @property {number} [contextWindow]
 * @property {number} [maxTokens]
 * @property {string[]} [inputModalities]
 */

/**
 * @typedef {object} RouteEntry
 * @property {string} key canonical model key
 * @property {string} name display name
 * @property {readonly Candidate[]} candidates ordered
 * @property {string} strategy
 * @property {number} [contextWindow] intersection across candidates
 * @property {number} [maxTokens] intersection across candidates
 * @property {string[]} inputModalities intersection across candidates
 * @property {string[]} pinned channels the user moved to the front
 */

/**
 * Build one route entry from the raw rows of every channel.
 *
 * @param {string} key canonical key
 * @param {readonly {provider: string, id: string, name?: string, contextWindow?: number, maxTokens?: number, inputModalities?: string[]}[]} rows
 * @param {{strategy?: string, pinned?: readonly string[]}} [options]
 * @returns {RouteEntry}
 */
export function buildRouteEntry(key, rows, options = {}) {
  const candidates = (rows ?? []).map(row => ({
    channel: String(row.provider),
    model: String(row.id),
    name: row.name === undefined ? undefined : String(row.name),
    ...Number.isFinite(row.contextWindow) ? { contextWindow: Number(row.contextWindow) } : {},
    ...Number.isFinite(row.maxTokens) ? { maxTokens: Number(row.maxTokens) } : {},
    ...Array.isArray(row.inputModalities) ? { inputModalities: row.inputModalities.map(String) } : {},
  }))
  const pinned = (options.pinned ?? []).filter(channel => candidates.some(c => c.channel === channel))
  const ordered = orderCandidates(candidates, pinned)
  return {
    key,
    name: canonicalDisplayName(rows),
    candidates: ordered,
    strategy: STRATEGIES.includes(options.strategy) ? options.strategy : DEFAULT_STRATEGY,
    contextWindow: intersectionOf(candidates, 'contextWindow'),
    maxTokens: intersectionOf(candidates, 'maxTokens'),
    inputModalities: intersectModalities(candidates),
    pinned,
  }
}

/**
 * Order candidates: pinned channels first (in the user's order), then the
 * rest in channel order. Strict by design — a pinned channel stays in front
 * even when an automatic score would rank it lower.
 */
export function orderCandidates(candidates, pinned = []) {
  const pinnedOrder = new Map(pinned.map((channel, index) => [channel, index]))
  return [...candidates].sort((a, b) => {
    const pa = pinnedOrder.has(a.channel) ? pinnedOrder.get(a.channel) : Number.MAX_SAFE_INTEGER
    const pb = pinnedOrder.has(b.channel) ? pinnedOrder.get(b.channel) : Number.MAX_SAFE_INTEGER
    if (pa !== pb) return pa - pb
    return a.channel.localeCompare(b.channel)
  })
}

/**
 * The smallest declared value across candidates — the one every candidate
 * can honour. `undefined` when no candidate declares it.
 */
export function intersectionOf(candidates, field) {
  let smallest
  for (const candidate of candidates) {
    const value = candidate[field]
    if (!Number.isFinite(value)) continue
    if (smallest === undefined || value < smallest) smallest = value
  }
  return smallest
}

/**
 * Modalities every candidate supports. A candidate that declares none is
 * treated as text-only (the conservative reading), so an image-capable head
 * cannot make the route advertise vision for a text-only fallback.
 */
export function intersectModalities(candidates) {
  let acc
  for (const candidate of candidates) {
    const modalities = candidate.inputModalities
    if (!Array.isArray(modalities) || modalities.length === 0) return ['text']
    const set = new Set(modalities.map(String))
    acc = acc === undefined ? set : new Set([...acc].filter(m => set.has(m)))
  }
  return acc === undefined ? ['text'] : [...acc]
}

export { canonicalModelKey }
