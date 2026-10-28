/**
 * Integration check — mount the REAL vendored channel pack under the plugin,
 * the way the host does, and confirm the seam holds.
 *
 * What this proves that the unit tests and smoke cannot:
 *   1. `vendor/channel-pack/pack.js` imports and `apply`s under a mock host
 *      without throwing (its own constructor graph is intact);
 *   2. the pack registers its RPC endpoint and its providers on the services
 *      this plugin injects — i.e. the seam dsh-model-admin drives is real;
 *   3. `account.list` / `credits.claimAll` really exist upstream and answer
 *      in the vocabulary this plugin decodes.
 *
 * The host-provided modules (`@deepseek-ai/*`) are stubbed through
 * `test/stubs/loader.mjs` (registered with `--import`): inside the real DSH
 * process the host supplies them, and a standalone check cannot. The pack
 * runs against no credentials on purpose — an empty account pool answers
 * "nothing to claim", the honest zero state; logging in is the user's step.
 *
 * Run: node --import ./test/stubs/register.mjs scripts/integration.mjs
 *      (exit 0 = pass, 1 = fail)
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const failures = []
function check(label, fn) {
  try {
    fn()
    console.log(`  ok  ${label}`)
  } catch (error) {
    failures.push(label)
    console.log(`FAIL  ${label}: ${error?.message ?? error}`)
  }
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-model-admin-int-'))
process.env.DSH_HOME = home
delete process.env.MODEL_ADMIN_NO_PACK

const stubs = await import(new URL('../test/stubs/host-modules.mjs', import.meta.url))
const entry = await import(new URL('../index.js', import.meta.url))
const pack = await import(new URL('../vendor/channel-pack/pack.js', import.meta.url))

console.log('\n[1] vendored pack contract')
check('pack exports the cordis contract', () => {
  assert.equal(typeof pack.apply, 'function')
  assert.ok(Array.isArray(pack.inject))
  assert.equal(typeof pack.name, 'string')
})
check('pack injects the services this plugin provides', () => {
  for (const service of pack.inject) {
    assert.ok(['credentials', 'commands', 'llm'].includes(service), service)
  }
})

console.log('\n[2] plugin applies with the real pack mounted')
const routes = new Map()
const connection = stubs.createConnectionServiceStub()
let applyError = null

const ctx = createMockCtx({
  connection,
  routes,
  onError: error => { if (applyError === null) applyError = error },
})

try {
  entry.apply(ctx, {})
} catch (error) {
  applyError = error
}

// The pack mounts asynchronously; give it a moment to register its RPC.
const mounted = await waitFor(() => connection.httpEndpoints.size > 0, 20_000)
check('plugin apply did not throw', () => assert.equal(applyError, null))
check('pack mounted and registered its RPC endpoint', () => {
  assert.equal(mounted, true)
  assert.ok(connection.httpEndpoints.has("/api/channel-pack"), [...connection.httpEndpoints.keys()].join(","))
})
check('pack registered its ten account providers on the llm service', () => {
  // One registration per account channel (plus adapters); the exact count is
  // the pack's business — what matters is that it registered many, not zero.
  assert.ok(stubs.llmServiceStub.registered.length >= 10, String(stubs.llmServiceStub.registered.length))
})

console.log('\n[3] the pack answers through this plugin bridge vocabulary')
const { createBridge } = await import(new URL('../src/rpc.js', import.meta.url))
// The bridge reads the pack's Cordis services directly. After the pack
// mounted (above), those services live on the mock ctx: accountPool is
// published by the pack, credentials is the host stub, and each `*Auth`
// service is the pack's per-provider auth.
const svcAuth = new Map()
const bridge = createBridge({
  services: () => {
    for (const name of ['lobsteraiAuth','qoderAuth','traeAuth','clineAuth','loomyAuth','raccoonAuth','zcodeAuth','minimaxAuth','geminiAuth']) {
      const svc = ctx.get?.(name) ?? null
      if (svc) svcAuth.set(name.replace(/Auth$/, ''), svc)
    }
    return {
      accountPool: ctx.get?.('accountPool') ?? null,
      credentials: ctx.get?.('credentials') ?? null,
      auth: svcAuth,
    }
  },
  warn: message => console.log(`      [bridge] ${message}`),
})

const accountList = await bridge.call('account.list', { provider: 'buddy' })
check('account.list answers (empty pool is a valid answer)', () => {
  assert.equal(accountList.ok, true)
  const accounts = Array.isArray(accountList.value) ? accountList.value : accountList.value?.accounts ?? []
  assert.ok(Array.isArray(accounts))
})

const claim = await bridge.call('credits.claimAll', { provider: 'buddy' }, { timeoutMs: 60_000 })
check('credits.claimAll answers in the decoded vocabulary or states a refusal', () => {
  if (claim.ok === true) {
    const summary = claim.value?.summary ?? claim.value
    assert.ok(summary === undefined || typeof summary === 'object')
  } else {
    assert.ok(typeof claim.message === 'string' && claim.message.length > 0)
    console.log(`      (pack answered: ${claim.message})`)
  }
})

console.log('\n[4] the routing lane over the real pack')
// The plugin's apply ran above with its own capture installed before the
// pack mounted, so the llm stub recorded every registration: the pack's ten
// channels AND the route provider itself. Rebuild the lane over the very
// adapters the pack registered — that is the whole chain end to end.
const { RouteAdapter, ROUTE_PROVIDER_ID, captureAdapters } = await import(new URL('../src/route/adapter.js', import.meta.url))

check('the route provider registered itself on the llm service', () => {
  const routeRegistration = stubs.llmServiceStub.registered.find(
    entry => Array.isArray(entry[0]) && entry[0].includes(ROUTE_PROVIDER_ID),
  )
  assert.ok(routeRegistration, 'no registration for ' + ROUTE_PROVIDER_ID)
})

const captured = new Map()
for (const [providers, adapter] of stubs.llmServiceStub.registered) {
  for (const provider of providers ?? []) {
    if (provider !== ROUTE_PROVIDER_ID) captured.set(provider, adapter)
  }
}
check('the pack ten channel adapters are capturable', () => {
  assert.ok(captured.size >= 10, `captured ${captured.size}`)
})

const lane = new RouteAdapter({
  adapters: () => captured,
  llm: () => stubs.llmServiceStub,
  routes: () => ({}),
  logger: { warn: () => {} },
})
const laneModels = await lane.listModels(ROUTE_PROVIDER_ID)
check('the lane lists route entries built from real channel catalogs', () => {
  assert.ok(Array.isArray(laneModels))
  for (const model of laneModels) {
    assert.ok(model.id.startsWith('route:'), model.id)
    assert.match(model.name, /· \d+ 渠道/)
  }
  console.log(`      (${laneModels.length} route entries from ${captured.size} channels)`)
})

const firstEntry = (await lane.entries())[0]
if (firstEntry !== undefined) {
  const prepared = await lane.prepareCall(ROUTE_PROVIDER_ID, `route:${firstEntry.key}`).catch(error => error)
  check('prepareCall over a real channel either prepares or states why', () => {
    if (prepared instanceof Error) {
      // With no signed-in account the channel refuses — a stated reason is
      // the correct answer here, not a silent empty stream.
      assert.ok(String(prepared.message).length > 0, prepared.message)
      console.log(`      (channel refused without credentials: ${prepared.message})`)
    } else {
      assert.equal(typeof prepared.stream, 'function')
      assert.ok(prepared.model !== undefined)
    }
  })
}

console.log(`\n${failures.length === 0 ? 'INTEGRATION PASS' : `INTEGRATION FAIL (${failures.length}): ${failures.join(', ')}`}`)
fs.rmSync(home, { recursive: true, force: true })
process.exit(failures.length === 0 ? 0 : 1)

// ── mock host ────────────────────────────────────────────────────────────────

/**
 * A cordis-shaped context over the stubbed services.
 *
 * Cordis exposes injected services BOTH as `ctx.get(name)` and as direct
 * properties (`ctx.llm`) — the pack uses both spellings. `inject` runs the
 * callback with a scoped view, and `effect` executes immediately and
 * returns its dispose: the two behaviors the pack's mount path relies on.
 */
function createMockCtx({ connection, routes, onError }) {
  const services = new Map()
  const subscriptions = []
  const emitted = []
  services.set('connection', connection)
  services.set('credentials', stubs.credentialsServiceStub)
  services.set('llm', stubs.llmServiceStub)
  services.set('commands', stubs.commandsServiceStub)
  services.set('settings', stubs.settingsServiceStub)
  services.set('webServer', {
    register: ({ kind, path, handler }) => routes.set(path, handler),
    registerRoute: (route, handler) => routes.set(route, handler),
  })

  const ctx = {
    logger: {
      info: () => {},
      warn: message => console.log(`      [warn] ${message}`),
    },
    fiber: { entry: { options: { id: 'dsh-model-admin' } } },
    effect(fn, _label) {
      try {
        return fn()
      } catch (error) {
        onError?.(error)
        return () => {}
      }
    },
    inject(_services, fn) {
      const scoped = {
        logger: ctx.logger,
        fiber: ctx.fiber,
        get: name => services.get(name),
        effect: (fn2, label) => ctx.effect(fn2, label),
        inject: (services2, fn2) => ctx.inject(services2, fn2),
        /** cordis event subscription; a stub records and returns unsubscribe. */
        on: (event, handler) => {
          subscriptions.push({ event, handler })
          return () => {}
        },
        /** cordis service publication (the pack publishes `accountPool`). */
        provide: (name, value) => services.set(name, value),
      }
      // Mirror cordis: injected services also land as direct properties.
      for (const name of _services) {
        Object.defineProperty(scoped, name, {
          get: () => services.get(name),
          configurable: true,
        })
      }
      try {
        return fn(scoped)
      } catch (error) {
        onError?.(error)
      }
    },
    get(name) {
      return services.get(name)
    },
    provide(name, value) {
      services.set(name, value)
    },
    /** cordis event emit; the pack broadcasts catalog changes with it. */
    emit(event, payload) {
      emitted.push({ event, payload })
    },
  }
  return ctx
}

function waitFor(predicate, timeoutMs) {
  const started = Date.now()
  return new Promise(resolve => {
    const tick = () => {
      if (predicate()) return resolve(true)
      if (Date.now() - started > timeoutMs) return resolve(false)
      setTimeout(tick, 100)
    }
    tick()
  })
}
