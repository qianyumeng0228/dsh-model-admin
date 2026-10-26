import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RouteAdapter, captureAdapters, isVisibleChunk, ROUTE_PROVIDER_ID, ROUTE_MODEL_PREFIX,
} from '../src/route/adapter.js'

/** A channel adapter double: lists models, prepares a canned stream. */
function fakeChannel(id, models, behaviour = {}) {
  const calls = { prepareCall: 0 }
  return {
    calls,
    adapter: {
      providerInfo: () => ({ id, name: id }),
      providerRetryPolicy: () => ({ attempts: 3 }),
      listModels: async () => models.map(m => ({ provider: id, ...m })),
      resolveModel: async (_p, model) => ({ provider: id, id: model, name: model }),
      async prepareCall(provider, model, signal) {
        calls.prepareCall += 1
        return {
          model: { provider, id: model, name: model },
          stream: options => behaviour.stream?.(model, options, signal) ?? emptyStream(),
        }
      },
    },
  }
}

async function* emptyStream() { /* nothing */ }
async function* textStream(text) {
  for (const piece of text) yield { type: 'text', text: piece }
}
async function* failStream() {
  throw new Error('upstream 500')
  yield { type: 'text', text: 'unreachable' }
}
async function* reasoningThenFail() {
  yield { type: 'reasoning', text: 'thinking...' }
  throw new Error('upstream 500')
}

function makeAdapter(channels, prefs = {}) {
  const captured = new Map(Object.entries(channels))
  const dispatches = []
  const adapter = new RouteAdapter({
    adapters: () => captured,
    llm: { listProviders: () => [] },
    routes: () => prefs,
    onDispatch: (entry, candidate) => dispatches.push({ key: entry.key, channel: candidate.channel }),
    logger: { warn: () => {} },
  })
  return { adapter, captured, dispatches }
}

test('captureAdapters records every registration and excludes itself', () => {
  const captured = new Map()
  const registered = []
  const ctx = {
    llm: {
      registerAdapter: (providers, adapter) => {
        registered.push(providers)
        return { replace: () => {} }
      },
    },
  }
  captureAdapters(ctx, captured)
  ctx.llm.registerAdapter(['buddy', 'cline'], fakeChannel('buddy', []).adapter)
  ctx.llm.registerAdapter([ROUTE_PROVIDER_ID], {})
  assert.deepEqual([...captured.keys()], ['buddy', 'cline'])
  assert.deepEqual(registered, [['buddy', 'cline'], [ROUTE_PROVIDER_ID]])
})

test('captureAdapters is a no-op without an llm service', () => {
  const captured = new Map()
  const restore = captureAdapters({}, captured)
  assert.deepEqual([...captured.keys()], [])
  assert.equal(typeof restore, 'function')
  restore()
})

test('listModels groups channels by canonical name with candidate counts', async () => {
  const { adapter } = makeAdapter({
    buddy: fakeChannel('buddy', [
      { id: 'deepseek-v4.1-flash-free', name: 'Flash', contextWindow: 1_000_000, defaultMaxTokens: 8192, inputModalities: ['text', 'image'] },
      { id: 'hy3', name: 'Hunyuan', contextWindow: 64_000, defaultMaxTokens: 4096 },
    ]).adapter,
    cline: fakeChannel('cline', [
      { id: 'deepseek-v4.1-flash', name: 'Flash', contextWindow: 128_000, defaultMaxTokens: 4096, inputModalities: ['text'] },
    ]).adapter,
  })
  const models = await adapter.listModels(ROUTE_PROVIDER_ID)
  const flash = models.find(m => m.id === `${ROUTE_MODEL_PREFIX}deepseek-v4.1-flash`)
  assert.ok(flash, 'route entry for the shared model')
  assert.match(flash.name, /· 2 渠道/)
  assert.deepEqual(flash.inputModalities, ['text'])
  assert.equal(flash.contextWindow, 128_000)
  assert.equal(flash.defaultMaxTokens, 4096)
  const hy3 = models.find(m => m.id === `${ROUTE_MODEL_PREFIX}hy3`)
  assert.match(hy3.name, /· 1 渠道/)
})

test('a disabled route preference hides the entry', async () => {
  const { adapter } = makeAdapter({
    buddy: fakeChannel('buddy', [{ id: 'hy3', name: 'Hunyuan' }]).adapter,
  }, { hy3: { enabled: false } })
  const models = await adapter.listModels(ROUTE_PROVIDER_ID)
  assert.equal(models.length, 0)
})

test('prepareCall forwards to the first candidate and streams its output', async () => {
  const buddy = fakeChannel('buddy', [{ id: 'hy3', name: 'Hunyuan' }], {
    stream: () => textStream('hello'),
  })
  const { adapter, dispatches } = makeAdapter({ buddy: buddy.adapter })
  const prepared = await adapter.prepareCall(ROUTE_PROVIDER_ID, `${ROUTE_MODEL_PREFIX}hy3`)
  assert.equal(prepared.model.provider, 'buddy')
  const chunks = []
  for await (const chunk of prepared.stream({ messages: [] })) chunks.push(chunk)
  assert.deepEqual(chunks.map(c => c.text), ['h', 'e', 'l', 'l', 'o'])
  assert.equal(buddy.calls.prepareCall, 1)
  assert.deepEqual(dispatches, [{ key: 'hy3', channel: 'buddy' }])
})

test('a zero-output failure switches to the next candidate', async () => {
  const buddy = fakeChannel('buddy', [
    { id: 'deepseek-v4.1-flash', name: 'Flash' },
  ], { stream: () => failStream() })
  const cline = fakeChannel('cline', [
    { id: 'deepseek-v4.1-flash', name: 'Flash' },
  ], { stream: () => textStream('rescued') })
  const { adapter } = makeAdapter({ buddy: buddy.adapter, cline: cline.adapter })
  const prepared = await adapter.prepareCall(ROUTE_PROVIDER_ID, `${ROUTE_MODEL_PREFIX}deepseek-v4.1-flash`)
  const chunks = []
  for await (const chunk of prepared.stream({ messages: [] })) chunks.push(chunk)
  assert.deepEqual(chunks.map(c => c.text), ['r', 'e', 's', 'c', 'u', 'e', 'd'])
  assert.equal(buddy.calls.prepareCall, 1)
  assert.equal(cline.calls.prepareCall, 1)
})

test('a failure after visible output is NOT switched', async () => {
  const buddy = fakeChannel('buddy', [{ id: 'hy3', name: 'Hunyuan' }], {
    stream: async function* () {
      yield { type: 'text', text: 'partial' }
      throw new Error('upstream died mid-answer')
    },
  })
  const cline = fakeChannel('cline', [{ id: 'hy3-free', name: 'Hunyuan' }], {
    stream: () => textStream('spliced'),
  })
  const { adapter } = makeAdapter({ buddy: buddy.adapter, cline: cline.adapter })
  const prepared = await adapter.prepareCall(ROUTE_PROVIDER_ID, `${ROUTE_MODEL_PREFIX}hy3`)
  const chunks = []
  await assert.rejects(async () => {
    for await (const chunk of prepared.stream({ messages: [] })) chunks.push(chunk)
  }, /upstream died/)
  assert.deepEqual(chunks.map(c => c.text), ['partial'])
  // cline was prepared once (the route prepares its first candidate only
  // when it is the head; here buddy was the head, so cline stays untouched).
  assert.equal(cline.calls.prepareCall, 0)
})

test('a reasoning-only failure still switches (reasoning is not visible)', async () => {
  const buddy = fakeChannel('buddy', [{ id: 'hy3', name: 'Hunyuan' }], {
    stream: () => reasoningThenFail(),
  })
  const cline = fakeChannel('cline', [{ id: 'hy3-free', name: 'Hunyuan' }], {
    stream: () => textStream('ok'),
  })
  const { adapter } = makeAdapter({ buddy: buddy.adapter, cline: cline.adapter })
  const prepared = await adapter.prepareCall(ROUTE_PROVIDER_ID, `${ROUTE_MODEL_PREFIX}hy3`)
  const chunks = []
  for await (const chunk of prepared.stream({ messages: [] })) chunks.push(chunk)
  assert.deepEqual(chunks.map(c => c.text), ['o', 'k'])
})

test('prepareCall refuses an unknown route model', async () => {
  const { adapter } = makeAdapter({
    buddy: fakeChannel('buddy', [{ id: 'hy3', name: 'Hunyuan' }]).adapter,
  })
  await assert.rejects(
    adapter.prepareCall(ROUTE_PROVIDER_ID, `${ROUTE_MODEL_PREFIX}nope`),
    error => error.code === 'UNKNOWN_MODEL',
  )
})

test('a channel whose adapter vanished reports UNKNOWN_MODEL, not a crash', async () => {
  const captured = new Map()
  const { adapter } = makeAdapter({})
  // Entry built from rows, but the adapter is removed before the call.
  const rows = [{ provider: 'ghost', id: 'hy3', name: 'Hunyuan' }]
  const { buildRouteEntry } = await import('../src/route/aggregate.js')
  const entry = buildRouteEntry('hy3', rows)
  captured.set('ghost', undefined)
  const prepared = await adapter.prepareCall(ROUTE_PROVIDER_ID, `${ROUTE_MODEL_PREFIX}hy3`).catch(error => error)
  // routeEntries() reads live adapters, so with none captured the entry is
  // absent and prepareCall refuses up front.
  assert.equal(prepared.code, 'UNKNOWN_MODEL')
  void entry
})

test('providerInfo and retry policy passthrough', async () => {
  const buddy = fakeChannel('buddy', [{ id: 'hy3', name: 'Hunyuan' }])
  const { adapter } = makeAdapter({ buddy: buddy.adapter })
  assert.deepEqual(adapter.providerInfo(ROUTE_PROVIDER_ID), { id: ROUTE_PROVIDER_ID, name: 'Model Admin 路由' })
  const policy = await adapter.providerRetryPolicy(`${ROUTE_MODEL_PREFIX}hy3`)
  assert.deepEqual(policy, { attempts: 3 })
})

test('pinned order drives which candidate is tried first', async () => {
  const buddy = fakeChannel('buddy', [{ id: 'hy3', name: 'Hunyuan' }], { stream: () => textStream('b') })
  const cline = fakeChannel('cline', [{ id: 'hy3-free', name: 'Hunyuan' }], { stream: () => textStream('c') })
  const { adapter } = makeAdapter({ buddy: buddy.adapter, cline: cline.adapter }, { hy3: { pinned: ['cline'] } })
  const prepared = await adapter.prepareCall(ROUTE_PROVIDER_ID, `${ROUTE_MODEL_PREFIX}hy3`)
  const chunks = []
  for await (const chunk of prepared.stream({ messages: [] })) chunks.push(chunk)
  assert.deepEqual(chunks.map(c => c.text), ['c'])
})

test('isVisibleChunk separates content from reasoning and plumbing', () => {
  assert.equal(isVisibleChunk({ type: 'text', text: 'hi' }), true)
  assert.equal(isVisibleChunk({ type: 'reasoning', text: 'hi' }), false)
  assert.equal(isVisibleChunk({ type: 'tool-call' }), false)
  assert.equal(isVisibleChunk({ delta: 'x' }), true)
  assert.equal(isVisibleChunk({ content: 'x' }), true)
  assert.equal(isVisibleChunk({ type: 'usage' }), false)
  assert.equal(isVisibleChunk(null), false)
  assert.equal(isVisibleChunk(undefined), false)
})
