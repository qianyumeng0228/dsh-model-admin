import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBridge, stableKey, RPC_CODES, PACK_ENDPOINT } from '../src/rpc.js'

/**
 * A Cordis-services double. The bridge calls `services()` for the account
 * pool / auth / credentials services directly — there is no RPC channel in
 * between, so the double must expose those concrete services.
 */
function fakeServices(impl = {}) {
  const calls = { listAccounts: 0, listAllAccounts: 0 }
  const pool = {
    listAccounts: async provider => {
      calls.listAccounts += 1
      if (impl.listAccounts) return impl.listAccounts(provider)
      return []
    },
    listAllAccounts: async () => {
      calls.listAllAccounts += 1
      if (impl.listAllAccounts) return impl.listAllAccounts()
      return []
    },
  }
  const auth = new Map()
  const credentials = { resolve: async () => undefined }
  return { svc: { accountPool: pool, auth, credentials }, calls }
}

test('call unwraps ok results and normalizes upstream errors', async () => {
  const fake = fakeServices({ listAccounts: () => [{ id: 'a1', provider: 'buddy' }] })
  const bridge = createBridge({ services: () => fake.svc })

  const ok = await bridge.call('account.list', { provider: 'buddy' })
  assert.deepEqual(ok, { ok: true, value: [{ id: 'a1', provider: 'buddy' }] })
  assert.equal(fake.calls.listAccounts, 1)

  // A throwing service call surfaces as UPSTREAM with the message.
  fake.svc.accountPool.listAccounts = async () => { throw new Error('nope') }
  const bad = await bridge.call('account.list', { provider: 'trae' })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, RPC_CODES.UPSTREAM)
  assert.equal(bad.message, 'nope')
})

test('call degrades to PACK_UNAVAILABLE when the pack is not mounted', async () => {
  const bridge = createBridge({ services: () => null })
  const result = await bridge.call('account.list')
  assert.equal(result.ok, false)
  assert.equal(result.code, RPC_CODES.PACK_UNAVAILABLE)
  assert.equal(bridge.available(), false)
})

test('call reports available when the pack is mounted', () => {
  const fake = fakeServices()
  const bridge = createBridge({ services: () => fake.svc })
  assert.equal(bridge.available(), true)
})

test('call times out and reports TIMEOUT', async () => {
  const fake = fakeServices({
    listAccounts: () => new Promise(() => { /* never settles */ }),
  })
  const bridge = createBridge({ services: () => fake.svc })
  const result = await bridge.call('account.list', { provider: 'buddy' }, { timeoutMs: 20 })
  assert.equal(result.ok, false)
  assert.equal(result.code, RPC_CODES.TIMEOUT)
})

test('call propagates an external abort as ABORTED', async () => {
  const fake = fakeServices({
    listAccounts: () => new Promise(() => { /* never settles */ }),
  })
  const bridge = createBridge({ services: () => fake.svc })
  const controller = new AbortController()
  const pending = bridge.call('account.list', {}, { signal: controller.signal })
  controller.abort()
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.code, RPC_CODES.ABORTED)
})

test('call caps a long upstream message', async () => {
  const fake = fakeServices({
    listAccounts: () => { throw new Error('x'.repeat(2000)) },
  })
  const bridge = createBridge({ services: () => fake.svc })
  const result = await bridge.call('account.list', { provider: 'buddy' })
  assert.equal(result.ok, false)
  assert.ok(result.message.length <= 600)
  assert.ok(result.message.endsWith('…'))
})

test('concurrent identical calls dedupe to one dispatch', async () => {
  let dispatches = 0
  const fake = fakeServices({
    listAccounts: async () => {
      dispatches += 1
      await new Promise(resolve => setTimeout(resolve, 10))
      return [{ id: `a${dispatches}`, provider: 'buddy' }]
    },
  })
  const bridge = createBridge({ services: () => fake.svc })
  const [a, b] = await Promise.all([
    bridge.call('account.list', { provider: 'buddy' }),
    bridge.call('account.list', { provider: 'buddy' }),
  ])
  assert.equal(dispatches, 1)
  assert.deepEqual(a, b)
})

test('an unknown method reports BAD_RESPONSE', async () => {
  const fake = fakeServices()
  const bridge = createBridge({ services: () => fake.svc })
  const result = await bridge.call('provider.status')
  assert.equal(result.ok, false)
  assert.equal(result.code, RPC_CODES.BAD_RESPONSE)
})

test('credits.claimAll returns a magpie-style summary', async () => {
  const fake = fakeServices({ listAccounts: () => [{ id: 'z1', enabled: true, provider: 'zcode' }] })
  // No auth service for the provider: every account lands in `inactive`.
  const bridge = createBridge({ services: () => fake.svc })
  const result = await bridge.call('credits.claimAll', { provider: 'zcode' })
  assert.equal(result.ok, true)
  assert.equal(result.value.summary.inactive, 1)
  assert.equal(result.value.summary.claimed, 0)
})

test('PACK_ENDPOINT stays stable for the data directory and UI', () => {
  assert.equal(PACK_ENDPOINT, 'channel-pack')
})

test('stableKey ignores object key order', () => {
  assert.equal(stableKey({ a: 1, b: 2 }), stableKey({ b: 2, a: 1 }))
  assert.equal(stableKey(undefined), '')
  assert.notEqual(stableKey({ a: 1 }), stableKey({ a: 2 }))
})
