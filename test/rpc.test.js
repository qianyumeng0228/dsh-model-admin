import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBridge, stableKey, RPC_CODES, PACK_ENDPOINT } from '../src/rpc.js'

/** A connection double whose call() records its arguments. */
function fakeConnection(handler) {
  const calls = []
  return {
    calls,
    service: {
      rpc: {
        call: async (path, endpoint, body, signal) => {
          calls.push({ path, endpoint, body, signal })
          return handler(body, signal)
        },
      },
    },
  }
}

test('call forwards the pack envelope and unwraps ok results', async () => {
  const conn = fakeConnection(body => (
    body.method === 'account.list' ? { ok: true, value: [{ id: 'a1' }] } : { ok: false, error: { message: 'nope' } }
  ))
  const bridge = createBridge({ connection: () => conn.service })

  const ok = await bridge.call('account.list', { provider: 'buddy' })
  assert.deepEqual(ok, { ok: true, value: [{ id: 'a1' }] })
  assert.equal(conn.calls[0].path, '/api')
  assert.equal(conn.calls[0].endpoint, PACK_ENDPOINT)
  assert.deepEqual(conn.calls[0].body, { method: 'account.list', payload: { provider: 'buddy' } })

  const bad = await bridge.call('credits.claimAll', { provider: 'trae' })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, RPC_CODES.UPSTREAM)
  assert.equal(bad.message, 'nope')
})

test('call degrades to PACK_UNAVAILABLE when the pack is not mounted', async () => {
  const bridge = createBridge({ connection: () => null })
  const result = await bridge.call('account.list')
  assert.equal(result.ok, false)
  assert.equal(result.code, RPC_CODES.PACK_UNAVAILABLE)
  assert.equal(bridge.available(), false)
})

test('call reports available when a transport exists', () => {
  const conn = fakeConnection(() => ({ ok: true, value: null }))
  const bridge = createBridge({ connection: () => conn.service })
  assert.equal(bridge.available(), true)
})

test('call times out and reports TIMEOUT', async () => {
  const conn = fakeConnection((_body, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')))
  }))
  const bridge = createBridge({ connection: () => conn.service })
  const result = await bridge.call('account.list', {}, { timeoutMs: 20 })
  assert.equal(result.ok, false)
  assert.equal(result.code, RPC_CODES.TIMEOUT)
})

test('call propagates an external abort as ABORTED', async () => {
  const conn = fakeConnection((_body, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')))
  }))
  const bridge = createBridge({ connection: () => conn.service })
  const controller = new AbortController()
  const pending = bridge.call('account.list', {}, { signal: controller.signal })
  controller.abort()
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.code, RPC_CODES.ABORTED)
})

test('call caps a long upstream message', async () => {
  const conn = fakeConnection(() => ({ ok: false, error: { message: 'x'.repeat(2000) } }))
  const bridge = createBridge({ connection: () => conn.service })
  const result = await bridge.call('account.list')
  assert.equal(result.ok, false)
  assert.ok(result.message.length <= 300)
  assert.ok(result.message.endsWith('…'))
})

test('concurrent identical calls dedupe to one dispatch', async () => {
  let dispatches = 0
  const conn = fakeConnection(() => {
    dispatches += 1
    return new Promise(resolve => setTimeout(() => resolve({ ok: true, value: dispatches }), 10))
  })
  const bridge = createBridge({ connection: () => conn.service })
  const [a, b] = await Promise.all([
    bridge.call('account.list', { provider: 'buddy' }),
    bridge.call('account.list', { provider: 'buddy' }),
  ])
  assert.equal(dispatches, 1)
  assert.deepEqual(a, b)
})

test('a bare value response is accepted as ok', async () => {
  const conn = fakeConnection(() => ({ channels: ['buddy'] }))
  const bridge = createBridge({ connection: () => conn.service })
  const result = await bridge.call('provider.status')
  assert.deepEqual(result, { ok: true, value: { channels: ['buddy'] } })
})

test('stableKey ignores object key order', () => {
  assert.equal(stableKey({ a: 1, b: 2 }), stableKey({ b: 2, a: 1 }))
  assert.equal(stableKey(undefined), '')
  assert.notEqual(stableKey({ a: 1 }), stableKey({ a: 2 }))
})
