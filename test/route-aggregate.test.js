import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRouteEntry, orderCandidates, intersectionOf, intersectModalities,
  pickCandidate, resetRotation, fallbackOrder, hasFallback, STRATEGIES,
} from '../src/route/aggregate.js'

const rows = [
  { provider: 'buddy', id: 'deepseek-v4.1-flash-free', name: 'Flash', contextWindow: 1_000_000, maxTokens: 8192, inputModalities: ['text', 'image'] },
  { provider: 'cline', id: 'deepseek-v4.1-flash', name: 'Flash', contextWindow: 128_000, maxTokens: 4096, inputModalities: ['text'] },
  { provider: 'trae', id: 'deepseek-v4.1-flash-sg', name: 'Flash', contextWindow: 256_000, maxTokens: 8192 },
]

test('buildRouteEntry groups by canonical key and takes the intersection', () => {
  const entry = buildRouteEntry('deepseek-v4.1-flash', rows)
  assert.equal(entry.candidates.length, 3)
  // 128K is the only window every candidate can honour.
  assert.equal(entry.contextWindow, 128_000)
  assert.equal(entry.maxTokens, 4096)
  // cline declares text-only; trae declares none -> text-only.
  assert.deepEqual(entry.inputModalities, ['text'])
  assert.equal(entry.strategy, 'fallback')
  assert.equal(entry.name, 'Flash')
})

test('a candidate declaring no modalities forces text-only', () => {
  const entry = buildRouteEntry('x', [
    { provider: 'a', id: 'x', inputModalities: ['text', 'image'] },
    { provider: 'b', id: 'x' },
  ])
  assert.deepEqual(entry.inputModalities, ['text'])
})

test('modalities intersect to the common set', () => {
  const entry = buildRouteEntry('x', [
    { provider: 'a', id: 'x', inputModalities: ['text', 'image'] },
    { provider: 'b', id: 'x', inputModalities: ['text', 'image', 'audio'] },
  ])
  assert.deepEqual(entry.inputModalities, ['text', 'image'])
})

test('pinned channels move to the front, strictly', () => {
  const entry = buildRouteEntry('x', rows, { pinned: ['trae'] })
  assert.equal(entry.candidates[0].channel, 'trae')
  assert.deepEqual(entry.pinned, ['trae'])
})

test('a pin naming an absent channel is dropped', () => {
  const entry = buildRouteEntry('x', rows, { pinned: ['gemini'] })
  assert.deepEqual(entry.pinned, [])
  assert.equal(entry.candidates[0].channel, 'buddy')
})

test('multi-pin keeps the user order', () => {
  const entry = buildRouteEntry('x', rows, { pinned: ['trae', 'cline'] })
  assert.deepEqual(entry.candidates.map(c => c.channel), ['trae', 'cline', 'buddy'])
})

test('orderCandidates is stable for unpinned ties', () => {
  const ordered = orderCandidates(rows.map(r => ({ channel: r.provider })))
  assert.deepEqual(ordered.map(c => c.channel), ['buddy', 'cline', 'trae'])
})

test('an unknown strategy falls back to the default', () => {
  const entry = buildRouteEntry('x', rows, { strategy: 'teleport' })
  assert.equal(entry.strategy, 'fallback')
  assert.ok(STRATEGIES.includes('fallback'))
})

test('fallback strategy always starts at the head', () => {
  const entry = buildRouteEntry('x', rows)
  assert.equal(pickCandidate(entry).channel, 'buddy')
  assert.equal(pickCandidate(entry).channel, 'buddy')
})

test('round-robin walks the whole list and wraps', () => {
  resetRotation()
  const entry = buildRouteEntry('x', rows, { strategy: 'round-robin' })
  const picks = [pickCandidate(entry), pickCandidate(entry), pickCandidate(entry), pickCandidate(entry)]
  assert.deepEqual(picks.map(c => c.channel), ['buddy', 'cline', 'trae', 'buddy'])
})

test('sticky keeps the conversation channel while it works', () => {
  const entry = buildRouteEntry('x', rows, { strategy: 'sticky' })
  assert.equal(pickCandidate(entry, { sticky: 'trae' }).channel, 'trae')
  // An unknown sticky channel degrades to the head, not a crash.
  assert.equal(pickCandidate(entry, { sticky: 'gemini' }).channel, 'buddy')
})

test('fallbackOrder skips the failed channel and keeps the rest in order', () => {
  const entry = buildRouteEntry('x', rows)
  assert.deepEqual(fallbackOrder(entry, 'buddy').map(c => c.channel), ['cline', 'trae'])
  assert.deepEqual(fallbackOrder(entry, 'trae').map(c => c.channel), ['buddy', 'cline'])
})

test('fallbackOrder tolerates an unknown failed channel', () => {
  const entry = buildRouteEntry('x', rows)
  assert.deepEqual(fallbackOrder(entry, 'nope').map(c => c.channel), ['buddy', 'cline', 'trae'])
})

test('hasFallback is false for a single-candidate route', () => {
  const single = buildRouteEntry('x', [rows[0]])
  assert.equal(hasFallback(single, 'buddy'), false)
  assert.equal(hasFallback(buildRouteEntry('x', rows), 'buddy'), true)
})

test('intersectionOf returns undefined when nothing declares the field', () => {
  assert.equal(intersectionOf([{ channel: 'a' }, { channel: 'b' }], 'contextWindow'), undefined)
  assert.equal(intersectionOf([], 'contextWindow'), undefined)
})
