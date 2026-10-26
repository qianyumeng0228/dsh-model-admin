import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toAccountView, toAccountViews, toCreditPackView, usableBalance, formatDuration,
  DEFAULT_EXPIRING_WINDOW_DAYS,
} from '../src/accounts.js'

const NOW = new Date('2026-10-26T00:00:00Z').getTime()
const DAY = 86_400_000

test('toAccountView marks a disabled account unusable', () => {
  const v = toAccountView({ id: 'a1', provider: 'buddy', disabled: true }, NOW)
  assert.equal(v.usable, false)
  assert.equal(v.statusText, '已停用')
})

test('toAccountView reports cooldown with a remaining duration', () => {
  const v = toAccountView({ id: 'a1', provider: 'buddy', cooldownUntil: NOW + 2 * DAY + 3 * 3_600_000 }, NOW)
  assert.equal(v.cooling, true)
  assert.equal(v.usable, false)
  assert.equal(v.cooldownRemainingMs, 2 * DAY + 3 * 3_600_000)
  assert.match(v.statusText, /冷却中（2d 3h）/)
})

test('toAccountView treats an expired cooldown as over', () => {
  const v = toAccountView({ id: 'a1', cooldownUntil: NOW - 1000 }, NOW)
  assert.equal(v.cooling, false)
  assert.equal(v.usable, true)
})

test('toAccountView marks long-lived tokens and warns on near expiry', () => {
  assert.equal(toAccountView({ id: 'a1' }, NOW).longLived, true)
  assert.equal(toAccountView({ id: 'a1', expiresAt: NOW + 2 * 3_600_000 }, NOW).statusText, '即将到期')
})

test('toAccountViews never throws on a malformed row', () => {
  const views = toAccountViews([null, {}, { id: 42 }], NOW)
  assert.equal(views.length, 3)
  assert.equal(views[2].id, '42')
})

test('toCreditPackView flags packs inside the expiring window only', () => {
  const soon = toCreditPackView({ name: 'p', remaining: 10, expiresAt: NOW + 5 * DAY }, NOW)
  assert.equal(soon.expiring, true)
  const later = toCreditPackView({ name: 'p', remaining: 10, expiresAt: NOW + 40 * DAY }, NOW)
  assert.equal(later.expiring, false)
  const permanent = toCreditPackView({ name: 'p', remaining: 10 }, NOW)
  assert.equal(permanent.expiring, false)
})

test('toCreditPackView honours a custom window', () => {
  // 3 days out is inside a 5-day window...
  assert.equal(toCreditPackView({ name: 'p', remaining: 1, expiresAt: NOW + 3 * DAY }, NOW, 5).expiring, true)
  // ...but outside the 15-day default it would have been inside.
  assert.equal(toCreditPackView({ name: 'p', remaining: 1, expiresAt: NOW + 3 * DAY }, NOW).expiring, true)
  // 10 days out is outside the 5-day window.
  assert.equal(toCreditPackView({ name: 'p', remaining: 1, expiresAt: NOW + 10 * DAY }, NOW, 5).expiring, false)
  // A zero window disables the flag entirely.
  assert.equal(toCreditPackView({ name: 'p', remaining: 1, expiresAt: NOW + DAY }, NOW, 0).expiring, false)
})

test('toCreditPackView marks a marketing drop pending until effective', () => {
  const pack = toCreditPackView({
    name: '1024', remaining: 5e8, unit: 'token', pendingEffectiveAt: NOW + 6 * 3_600_000,
  }, NOW)
  assert.equal(pack.pending, true)
})

test('usableBalance excludes pending buckets and splits units', () => {
  const bal = usableBalance([
    { name: 'credit', remaining: 100 },
    { name: 'tokens', remaining: 5000, unit: 'token' },
    { name: 'drop', remaining: 5e8, unit: 'token', pendingEffectiveAt: NOW + 3_600_000 },
    { name: 'expiring', remaining: 40, expiresAt: NOW + 3 * DAY },
  ], NOW)
  assert.equal(bal.credit, 140)
  assert.equal(bal.token, 5000)
  assert.equal(bal.expiringCredit, 40)
  assert.equal(bal.expiringToken, 0)
})

test('formatDuration reads as days+hours, hours+minutes, minutes', () => {
  assert.equal(formatDuration(2 * DAY + 3 * 3_600_000), '2d 3h')
  assert.equal(formatDuration(5 * 3_600_000 + 12 * 60_000), '5h 12m')
  assert.equal(formatDuration(12 * 60_000), '12m')
  assert.equal(formatDuration(-5), '0m')
})

test('DEFAULT_EXPIRING_WINDOW_DAYS matches the vendored pack', () => {
  assert.equal(DEFAULT_EXPIRING_WINDOW_DAYS, 15)
})
