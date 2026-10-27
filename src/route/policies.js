/**
 * magpie-style routing strategies.
 *
 * Each strategy decides which candidate gets the first turn. The caller
 * (RouteAdapter) walks the rest as fallback when the first produced no
 * visible output.
 */

/** All strategies, ordered by preference in the UI. */
export const STRATEGIES = Object.freeze([
  'smart',      // default: soonest quota reset first, failed last
  'order',      // strict: first candidate, then fallback
  'rotate',     // round-robin per turn
  'usage',      // most remaining quota first
  'fast',       // fastest recent response first
  'weight',     // weighted distribution
  'pace',       // use up quota before reset
])

export const DEFAULT_STRATEGY = 'smart'

const rotation = new Map()

/**
 * Pick the first candidate for a turn.
 *
 * @param {object} entry RouteEntry from buildRouteEntry
 * @param {object} state
 * @param {string} [state.sticky] last successful channel (for sticky behavior)
 * @param {Map} [state.stats] per-channel dispatch stats
 * @param {number} [state.timestamp] current time ms
 */
export function pickCandidate(entry, state = {}) {
  const candidates = entry.candidates
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]

  switch (entry.strategy) {
    case 'rotate': {
      const cursor = rotation.get(entry.key) ?? 0
      rotation.set(entry.key, (cursor + 1) % candidates.length)
      return candidates[cursor % candidates.length]
    }

    case 'usage': {
      // Sort by remaining quota (higher = better). Without quota data,
      // fall back to first candidate.
      const stats = state.stats ?? new Map()
      return [...candidates].sort((a, b) => {
        const ua = stats.get(a.channel)?.remaining ?? Infinity
        const ub = stats.get(b.channel)?.remaining ?? Infinity
        return ub - ua
      })[0]
    }

    case 'fast': {
      // Sort by recent latency (lower = better). Without latency data,
      // fall back to first candidate.
      const stats = state.stats ?? new Map()
      return [...candidates].sort((a, b) => {
        const la = stats.get(a.channel)?.avgLatency ?? Infinity
        const lb = stats.get(b.channel)?.avgLatency ?? Infinity
        return la - lb
      })[0]
    }

    case 'weight': {
      // Weighted random. Weights default to 1.
      const weights = entry.weights ?? {}
      const total = candidates.reduce((sum, c) => sum + (weights[c.channel] ?? 1), 0)
      let r = Math.random() * total
      for (const c of candidates) {
        r -= (weights[c.channel] ?? 1)
        if (r <= 0) return c
      }
      return candidates[0]
    }

    case 'pace': {
      // Use up quota before reset: highest remaining-credits-per-hour ratio.
      const stats = state.stats ?? new Map()
      return [...candidates].sort((a, b) => {
        const ra = stats.get(a.channel)?.creditsPerHour ?? 0
        const rb = stats.get(b.channel)?.creditsPerHour ?? 0
        return rb - ra
      })[0]
    }

    case 'order':
    case 'smart':
    default:
      // smart = order for now: pinned first, then channel order.
      // TODO: smart should sort by quota reset time when stats available.
      return candidates[0]
  }
}

export function fallbackOrder(entry, failedChannel) {
  const start = entry.candidates.findIndex(c => c.channel === failedChannel)
  if (start < 0) return entry.candidates
  return [...entry.candidates.slice(start + 1), ...entry.candidates.slice(0, start)]
}

export function hasFallback(entry, failedChannel) {
  return entry.candidates.some(c => c.channel !== failedChannel)
}

export function resetRotation() {
  rotation.clear()
}
