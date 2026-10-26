/**
 * Daily check-in scheduling — the "did today already run?" decision, kept
 * pure so the timer cannot drift and the UI cannot lie.
 *
 * The day boundary is UTC+8 (the upstream campaigns reset at Beijing
 * midnight), not the host's local zone: a machine in another zone would
 * otherwise re-run or skip a day depending on where it sits.
 */

/** Milliseconds in one UTC+8 calendar day boundary check. */
const DAY_MS = 86_400_000

/** UTC+8 offset in milliseconds (no DST in the China standard zone). */
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * The UTC+8 calendar date as `YYYY-MM-DD`.
 * @param {number} nowMs epoch milliseconds
 * @returns {string}
 */
export function utc8DateString(nowMs) {
  const shifted = new Date(nowMs + UTC8_OFFSET_MS)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Whether a run recorded under `lastDate` still counts as today's run.
 * An empty or malformed `lastDate` never counts.
 * @param {string} lastDate stored `YYYY-MM-DD`
 * @param {number} nowMs
 * @returns {boolean}
 */
export function ranToday(lastDate, nowMs) {
  if (typeof lastDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(lastDate)) return false
  return lastDate === utc8DateString(nowMs)
}

/**
 * Whether a stored run should be marked as today's, given what it collected.
 *
 * A run that only hit "no check-in endpoint" / "needs manual" channels did
 * not accomplish today's purpose, so it must NOT be recorded — otherwise the
 * day is burned and tomorrow's real claim is silently skipped.
 *
 * @param {{claimed: number, alreadyClaimed: number}} totals
 * @returns {boolean}
 */
export function shouldMarkToday(totals) {
  const claimed = Number(totals?.claimed) || 0
  const already = Number(totals?.alreadyClaimed) || 0
  return claimed + already > 0
}

/**
 * Milliseconds until the next UTC+8 midnight — the moment a new check-in day
 * opens. Never negative; a caller scheduling at exactly midnight gets a full
 * day rather than a zero-delay spin.
 * @param {number} nowMs
 * @returns {number}
 */
export function msUntilNextUtc8Midnight(nowMs) {
  const shifted = nowMs + UTC8_OFFSET_MS
  const remainder = shifted % DAY_MS
  return DAY_MS - remainder
}

/**
 * The hour (0–23, UTC+8) a daily job should fire at, given a preferred local
 * hour. Upstream campaigns reset at midnight Beijing time, so the default
 * window is early morning; a caller may pass its configured hour.
 * @param {number} preferredHour 0–23
 * @param {number} nowMs
 * @returns {number} delay in ms, at least 0
 */
export function delayUntilHourUtc8(preferredHour, nowMs) {
  const hour = Number.isInteger(preferredHour) && preferredHour >= 0 && preferredHour <= 23
    ? preferredHour
    : 9
  const shifted = nowMs + UTC8_OFFSET_MS
  const shiftedDate = new Date(shifted)
  const target = Date.UTC(
    shiftedDate.getUTCFullYear(),
    shiftedDate.getUTCMonth(),
    shiftedDate.getUTCDate(),
    hour,
    0,
    0,
  ) - UTC8_OFFSET_MS
  const delta = target - nowMs
  return delta > 0 ? delta : delta + DAY_MS
}
