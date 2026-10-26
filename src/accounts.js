/**
 * Account view normalization — turn the pack's raw account rows into the
 * shape the panel renders, and answer the two questions the panel asks
 * without making the panel do arithmetic:
 *
 * 1. which accounts are usable right now (not disabled, not in cooldown);
 * 2. which credit packs expire soon (the "burn the expiring one first" rule
 *    upstream applies: a pack whose deduction deadline is within the window
 *    counts as temporary and is spent before permanent credits).
 */

/** Default temporary-credit window, matching the vendored pack. */
export const DEFAULT_EXPIRING_WINDOW_DAYS = 15

const DAY_MS = 86_400_000

/**
 * @typedef {object} RawAccount
 * @property {string} id
 * @property {string} [accountName]
 * @property {string} [provider]
 * @property {boolean} [disabled]
 * @property {number} [expiresAt] epoch ms, 0/absent = long-lived
 * @property {number} [cooldownUntil] epoch ms, absent = not cooling
 * @property {string} [note]
 */

/**
 * @typedef {object} AccountView
 * @property {string} id
 * @property {string} channel
 * @property {string} name
 * @property {boolean} disabled
 * @property {boolean} cooling
 * @property {number} cooldownRemainingMs
 * @property {boolean} longLived token never expires
 * @property {number} expiresAt
 * @property {boolean} usable
 * @property {string} statusText
 */

/**
 * Normalize one raw row. Never throws on missing fields: the pack's shape is
 * upstream's to change, and a malformed row must render as "unknown", not
 * crash the whole list.
 *
 * @param {RawAccount} raw
 * @param {number} nowMs
 * @returns {AccountView}
 */
export function toAccountView(raw, nowMs = Date.now()) {
  const id = String(raw?.id ?? '')
  const expiresAt = Number.isFinite(raw?.expiresAt) && raw.expiresAt > 0 ? Number(raw.expiresAt) : 0
  const cooldownUntil = Number.isFinite(raw?.cooldownUntil) && raw.cooldownUntil > nowMs
    ? Number(raw.cooldownUntil)
    : 0
  const disabled = raw?.disabled === true
  const cooling = cooldownUntil > 0

  let statusText = '可用'
  if (disabled) statusText = '已停用'
  else if (cooling) statusText = `冷却中（${formatDuration(cooldownUntil - nowMs)}）`
  else if (expiresAt > 0 && expiresAt - nowMs < DAY_MS) statusText = '即将到期'

  return {
    id,
    channel: String(raw?.provider ?? ''),
    name: String(raw?.accountName ?? raw?.name ?? id),
    disabled,
    cooling,
    cooldownRemainingMs: cooling ? cooldownUntil - nowMs : 0,
    longLived: expiresAt === 0,
    expiresAt,
    usable: !disabled && !cooling,
    statusText,
  }
}

/**
 * @param {readonly RawAccount[]} rows
 * @param {number} nowMs
 * @returns {AccountView[]}
 */
export function toAccountViews(rows, nowMs = Date.now()) {
  return (rows ?? []).map(row => toAccountView(row, nowMs))
}

/**
 * @typedef {object} RawCreditPack
 * @property {string} [name]
 * @property {number} [remaining]
 * @property {number} [total]
 * @property {number} [expiresAt] deduction deadline, 0/absent = permanent
 * @property {string} [unit] 'credit' | 'token'
 */

/**
 * @typedef {object} CreditPackView
 * @property {string} name
 * @property {number} remaining
 * @property {number} total
 * @property {string} unit
 * @property {boolean} expiring within the window
 * @property {number} expiresAt
 * @property {boolean} pending not yet effective (marketing drops)
 */

/**
 * Normalize one credit pack. `pendingEffectiveAt` is the marketing-campaign
 * case upstream reports: the claim succeeded but the bucket only opens at a
 * later timestamp, so it must not be counted as available yet.
 *
 * @param {RawCreditPack & {pendingEffectiveAt?: number}} raw
 * @param {number} nowMs
 * @param {number} [windowDays]
 * @returns {CreditPackView}
 */
export function toCreditPackView(raw, nowMs = Date.now(), windowDays = DEFAULT_EXPIRING_WINDOW_DAYS) {
  const windowMs = Math.max(0, Number(windowDays) || 0) * DAY_MS
  const expiresAt = Number.isFinite(raw?.expiresAt) && raw.expiresAt > 0 ? Number(raw.expiresAt) : 0
  const pendingAt = Number.isFinite(raw?.pendingEffectiveAt) && raw.pendingEffectiveAt > 0
    ? Number(raw.pendingEffectiveAt)
    : 0
  const pending = pendingAt > nowMs
  return {
    name: String(raw?.name ?? ''),
    remaining: Math.max(0, Number(raw?.remaining) || 0),
    total: Math.max(0, Number(raw?.total) || 0),
    unit: raw?.unit === 'token' ? 'token' : 'credit',
    expiring: !pending && expiresAt > 0 && expiresAt - nowMs < windowMs,
    expiresAt,
    pending,
  }
}

/**
 * One account's usable balance right now, by unit. Pending buckets are
 * excluded (they cannot be spent yet); expiring ones are included but
 * flagged so the panel can sort them first.
 *
 * @param {readonly (RawCreditPack & {pendingEffectiveAt?: number})[]} packs
 * @param {number} nowMs
 * @returns {{credit: number, token: number, expiringCredit: number, expiringToken: number}}
 */
export function usableBalance(packs, nowMs = Date.now()) {
  const out = { credit: 0, token: 0, expiringCredit: 0, expiringToken: 0 }
  for (const raw of packs ?? []) {
    const pack = toCreditPackView(raw, nowMs)
    if (pack.pending) continue
    const target = pack.unit === 'token' ? 'token' : 'credit'
    out[target] += pack.remaining
    if (pack.expiring) {
      out[target === 'token' ? 'expiringToken' : 'expiringCredit'] += pack.remaining
    }
  }
  return out
}

/** Compact "3d 4h" / "5h 12m" / "12m" duration text. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}
