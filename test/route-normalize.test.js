import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalModelKey, canonicalDisplayName, groupByCanonical } from '../src/route/normalize.js'

test('the same model on three channels normalizes to one key', () => {
  const keys = new Set([
    canonicalModelKey('deepseek-v4.1-flash'),
    canonicalModelKey('deepseek-v4.1-flash-free'),
    canonicalModelKey('DeepSeek-V4.1-Flash-SG'),
  ])
  assert.equal(keys.size, 1)
  // flash is the product line: the tier markers go, the line stays.
  assert.equal([...keys][0], 'deepseek-v4.1-flash')
})

test('tier suffixes are stripped but flash identity survives', () => {
  // -flash is a product line, not a tier marker: v4.1-flash and v4.1 differ.
  assert.equal(canonicalModelKey('deepseek-v4.1'), 'deepseek-v4.1')
  assert.equal(canonicalModelKey('deepseek-v4.1-flash'), 'deepseek-v4.1-flash')
  assert.equal(canonicalModelKey('glm-5.3-flash-free'), 'glm-5.3-flash')
})

test('separators normalize and runs collapse', () => {
  assert.equal(canonicalModelKey('GLM_5.3--Flash'), 'glm-5.3-flash')
  assert.equal(canonicalModelKey('  MiniMax--M2  '), 'minimax-m2')
})

test('a vendor namespace prefix is dropped', () => {
  assert.equal(canonicalModelKey('buddy/deepseek-v4.1-flash'), 'deepseek-v4.1-flash')
})

test('at most two tier suffixes strip, then the key is stable', () => {
  assert.equal(canonicalModelKey('kimi-k3-free-cn'), 'kimi-k3')
  assert.equal(canonicalModelKey('kimi-k3'), 'kimi-k3')
})

test('junk input yields an empty key, never a crash', () => {
  assert.equal(canonicalModelKey(''), '')
  assert.equal(canonicalModelKey(undefined), '')
  assert.equal(canonicalModelKey('---'), '')
})

test('canonicalDisplayName picks the most frequent, ties to the shorter', () => {
  const members = [
    { id: 'a', name: 'DeepSeek V4.1 Flash (free)' },
    { id: 'b', name: 'DeepSeek V4.1 Flash' },
    { id: 'c', name: 'DeepSeek V4.1 Flash' },
  ]
  assert.equal(canonicalDisplayName(members), 'DeepSeek V4.1 Flash')
})

test('canonicalDisplayName falls back to the first id when no names', () => {
  assert.equal(canonicalDisplayName([{ id: 'kimi-k3' }, { id: 'kimi-k3-free' }]), 'kimi-k3')
  assert.equal(canonicalDisplayName([]), '')
})

test('groupByCanonical buckets rows and drops unkeyable ones', () => {
  const groups = groupByCanonical([
    { provider: 'buddy', id: 'deepseek-v4.1-flash-free', name: 'Flash' },
    { provider: 'cline', id: 'deepseek-v4.1-flash', name: 'Flash' },
    { provider: 'gemini', id: '', name: 'broken' },
    { provider: 'trae', id: 'hy3', name: 'Hunyuan' },
  ])
  assert.equal(groups.size, 2)
  assert.equal(groups.get('deepseek-v4.1-flash').length, 2)
  assert.equal(groups.get('hy3').length, 1)
})
