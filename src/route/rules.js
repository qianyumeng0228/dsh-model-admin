/**
 * Route rule engine — magpie-style.
 *
 * Rules are checked top-down for each turn. The first matching rule decides
 * which candidate is pinned to the front. Unmatched turns fall through to
 * the route strategy.
 *
 * Rule conditions (all must match within one rule):
 * - minTokens: request must be at least N tokens
 * - hasImages: request contains image content
 * - reasoning: request asks for reasoning/thinking
 * - timeWindow: only active during this time range (e.g. "14:00-18:00")
 * - days: only active on these weekdays (e.g. ["mon","tue"])
 */

/**
 * @typedef {object} RouteRule
 * @property {string} id
 * @property {string} targetChannel — which channel to pin when matched
 * @property {number} [minTokens]
 * @property {boolean} [hasImages]
 * @property {boolean} [reasoning]
 * @property {string} [timeWindow] — "HH:MM-HH:MM" local time
 * @property {string[]} [days] — ["mon","tue","wed","thu","fri","sat","sun"]
 * @property {boolean} [enabled]
 */

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/**
 * Evaluate rules against a request context.
 *
 * @param {readonly RouteRule[]} rules
 * @param {object} ctx
 * @param {number} [ctx.tokens] estimated request tokens
 * @param {boolean} [ctx.hasImages]
 * @param {boolean} [ctx.reasoning]
 * @param {Date} [ctx.now]
 * @returns {RouteRule|undefined} first matching rule
 */
export function matchRule(rules, ctx = {}) {
  if (!Array.isArray(rules)) return undefined
  const now = ctx.now ?? new Date()
  const day = DAY_NAMES[now.getDay()]
  const minutes = now.getHours() * 60 + now.getMinutes()

  for (const rule of rules) {
    if (rule.enabled === false) continue
    if (!rule.targetChannel) continue

    if (typeof rule.minTokens === 'number' && (ctx.tokens ?? 0) < rule.minTokens) continue
    if (rule.hasImages === true && !ctx.hasImages) continue
    if (rule.reasoning === true && !ctx.reasoning) continue

    if (Array.isArray(rule.days) && rule.days.length > 0 && !rule.days.includes(day)) continue

    if (rule.timeWindow) {
      const [start, end] = rule.timeWindow.split('-').map(parseTime)
      if (start !== undefined && end !== undefined) {
        if (minutes < start || minutes > end) continue
      }
    }

    return rule
  }
  return undefined
}

function parseTime(str) {
  const m = String(str).trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return undefined
  return Number(m[1]) * 60 + Number(m[2])
}

/**
 * Apply a matched rule: move the rule's target channel to the front.
 *
 * @param {readonly {channel:string}[]} candidates
 * @param {RouteRule|undefined} rule
 * @returns {{channel:string}[]} reordered candidates
 */
export function applyRule(candidates, rule) {
  if (!rule) return [...candidates]
  const target = candidates.find(c => c.channel === rule.targetChannel)
  if (!target) return [...candidates]
  return [target, ...candidates.filter(c => c.channel !== rule.targetChannel)]
}
