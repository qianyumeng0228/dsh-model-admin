/**
 * Run-result aggregation — pure math over one check-in round's per-channel
 * rows. The console shows per-channel outcomes and a summary that never
 * sums across units (credits and tokens are different dimensions; adding
 * them produces a number that means nothing).
 */

/**
 * @typedef {object} ChannelRunRow
 * @property {string} channel channel id
 * @property {'claimed'|'already'|'skipped'|'failed'|'inactive'} outcome
 * @property {number} [credit] credits claimed this round
 * @property {number} [token] tokens claimed this round
 * @property {string} [message] failure reason, for the row's tooltip
 */

/** A fresh, zeroed accumulator. */
export function emptyTotals() {
  return {
    channels: 0,
    claimed: 0,
    alreadyClaimed: 0,
    failed: 0,
    skipped: 0,
    inactive: 0,
    /** Sum of credit-unit claims. */
    credit: 0,
    /** Sum of token-unit claims. Kept separate on purpose. */
    token: 0,
  }
}

/**
 * Fold one channel's row into the accumulator.
 * @param {ReturnType<typeof emptyTotals>} totals mutated in place
 * @param {ChannelRunRow} row
 * @returns {ReturnType<typeof emptyTotals>} the same accumulator
 */
export function foldRow(totals, row) {
  totals.channels += 1
  switch (row?.outcome) {
    case 'claimed':
      totals.claimed += 1
      totals.credit += Number(row.credit) || 0
      totals.token += Number(row.token) || 0
      break
    case 'already':
      totals.alreadyClaimed += 1
      break
    case 'inactive':
      totals.inactive += 1
      break
    case 'skipped':
      totals.skipped += 1
      break
    default:
      totals.failed += 1
      break
  }
  return totals
}

/**
 * Reduce a whole round.
 * @param {readonly ChannelRunRow[]} rows
 * @returns {ReturnType<typeof emptyTotals>}
 */
export function summarize(rows) {
  const totals = emptyTotals()
  for (const row of rows ?? []) foldRow(totals, row)
  return totals
}

/**
 * One-line human summary of a round, in the upstream's style: units are
 * listed separately and a run that collected nothing says so plainly.
 * @param {readonly ChannelRunRow[]} rows
 * @returns {string}
 */
export function describeRun(rows) {
  const t = summarize(rows)
  const parts = []
  if (t.claimed > 0) {
    const units = []
    if (t.credit > 0) units.push(`${formatAmount(t.credit)} 积分`)
    if (t.token > 0) units.push(`${formatAmount(t.token)} Token`)
    parts.push(`${t.claimed} 个渠道领取${units.length > 0 ? `（${units.join(' + ')}）` : ''}`)
  }
  if (t.alreadyClaimed > 0) parts.push(`${t.alreadyClaimed} 个今日已领`)
  if (t.inactive > 0) parts.push(`${t.inactive} 个未开启`)
  if (t.skipped > 0) parts.push(`${t.skipped} 个无签到`)
  if (t.failed > 0) parts.push(`${t.failed} 个失败`)
  if (parts.length === 0) return '无可领取'
  return parts.join('，')
}

/**
 * Compact amount formatting: 5 000 000 000 reads as 5B, 12 500 as 12.5K.
 * Keeps the dashboard's credit column from wrapping.
 * @param {number} n
 * @returns {string}
 */
export function formatAmount(n) {
  const value = Number(n)
  if (!Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${trimZero(value / 1e9)}B`
  if (abs >= 1e6) return `${trimZero(value / 1e6)}M`
  if (abs >= 1e4) return `${trimZero(value / 1e3)}K`
  return String(Math.round(value))
}

function trimZero(x) {
  const fixed = x.toFixed(2).replace(/\.?0+$/, '')
  return fixed
}
