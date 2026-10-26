import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyTotals, foldRow, summarize, describeRun, formatAmount,
} from '../src/runs.js'

test('summarize counts each outcome once', () => {
  const rows = [
    { channel: 'buddy', outcome: 'claimed', credit: 100 },
    { channel: 'trae', outcome: 'claimed', token: 500 },
    { channel: 'codearts', outcome: 'already' },
    { channel: 'loomy', outcome: 'failed', message: 'sms expired' },
    { channel: 'zcode', outcome: 'inactive' },
    { channel: 'gemini', outcome: 'skipped' },
  ]
  const t = summarize(rows)
  assert.equal(t.channels, 6)
  assert.equal(t.claimed, 2)
  assert.equal(t.alreadyClaimed, 1)
  assert.equal(t.failed, 1)
  assert.equal(t.inactive, 1)
  assert.equal(t.skipped, 1)
  assert.equal(t.credit, 100)
  assert.equal(t.token, 500)
})

test('describeRun keeps units separate instead of summing them', () => {
  const text = describeRun([
    { channel: 'buddy', outcome: 'claimed', credit: 100 },
    { channel: 'zcode', outcome: 'claimed', token: 500 },
  ])
  assert.match(text, /100 积分/)
  assert.match(text, /500 Token/)
  assert.match(text, /\+/)
})

test('describeRun says 无可领取 when nothing was collected', () => {
  assert.equal(describeRun([]), '无可领取')
  assert.equal(describeRun([{ channel: 'gemini', outcome: 'skipped' }]), '1 个无签到')
})

test('formatAmount compacts large numbers and trims zeros', () => {
  assert.equal(formatAmount(5_000_000_000), '5B')
  assert.equal(formatAmount(12_500_000), '12.5M')
  assert.equal(formatAmount(12_500), '12.5K')
  assert.equal(formatAmount(999), '999')
  assert.equal(formatAmount(Number.NaN), '0')
})

test('foldRow tolerates a missing credit field', () => {
  const t = foldRow(emptyTotals(), { channel: 'x', outcome: 'claimed' })
  assert.equal(t.claimed, 1)
  assert.equal(t.credit, 0)
  assert.equal(t.token, 0)
})
