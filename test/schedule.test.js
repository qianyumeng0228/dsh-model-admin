import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  utc8DateString, ranToday, shouldMarkToday, msUntilNextUtc8Midnight, delayUntilHourUtc8,
} from '../src/schedule.js'

const at = (iso) => new Date(iso).getTime()

test('utc8DateString shifts the boundary to Beijing midnight', () => {
  // 2026-10-26T16:30:00Z is already 2026-10-27 00:30 in UTC+8.
  assert.equal(utc8DateString(at('2026-10-26T16:30:00Z')), '2026-10-27')
  // One hour earlier is still the previous UTC+8 day.
  assert.equal(utc8DateString(at('2026-10-26T15:30:00Z')), '2026-10-26')
})

test('ranToday compares against the UTC+8 day, not the host zone', () => {
  const now = at('2026-10-26T17:00:00Z') // 2026-10-27 01:00 UTC+8
  assert.equal(ranToday('2026-10-27', now), true)
  assert.equal(ranToday('2026-10-26', now), false)
  assert.equal(ranToday('', now), false)
  assert.equal(ranToday(undefined, now), false)
  assert.equal(ranToday('not-a-date', now), false)
})

test('shouldMarkToday refuses runs that accomplished nothing', () => {
  assert.equal(shouldMarkToday({ claimed: 0, alreadyClaimed: 0 }), false)
  assert.equal(shouldMarkToday({ claimed: 1, alreadyClaimed: 0 }), true)
  assert.equal(shouldMarkToday({ claimed: 0, alreadyClaimed: 3 }), true)
  assert.equal(shouldMarkToday({}), false)
})

test('msUntilNextUtc8Midnight lands on the boundary and never goes negative', () => {
  const justBefore = at('2026-10-26T15:59:59Z') // 23:59:59 UTC+8
  assert.equal(msUntilNextUtc8Midnight(justBefore), 1000)
  const exactly = at('2026-10-26T16:00:00Z') // 00:00:00 UTC+8
  assert.equal(msUntilNextUtc8Midnight(exactly), 86_400_000)
})

test('delayUntilHourUtc8 schedules today when the hour is still ahead', () => {
  const now = at('2026-10-26T01:00:00Z') // 09:00 UTC+8
  // 10:00 UTC+8 is one hour away.
  assert.equal(delayUntilHourUtc8(10, now), 3_600_000)
})

test('delayUntilHourUtc8 rolls to tomorrow once the hour passed', () => {
  const now = at('2026-10-26T02:00:00Z') // 10:00 UTC+8
  // Target 09:00 UTC+8 already passed today -> next day, 23h later.
  assert.equal(delayUntilHourUtc8(9, now), 23 * 3_600_000)
})

test('delayUntilHourUtc8 falls back to 09:00 for junk input', () => {
  const now = at('2026-10-26T00:00:00Z') // 08:00 UTC+8
  assert.equal(delayUntilHourUtc8(Number.NaN, now), 3_600_000)
  assert.equal(delayUntilHourUtc8(99, now), 3_600_000)
})
