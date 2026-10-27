/**
 * Smoke test — load the plugin the way the host does and drive one full
 * check-in round over a fake pack, end to end.
 *
 * What this proves:
 *   1. the plugin's entry imports cleanly and exports the cordis contract
 *      (name / inject / Config / apply);
 *   2. `apply` under a mock host mounts the console API and the scheduler
 *      without a pack present, and degrades with a stated reason;
 *   3. a check-in round against a fake pack produces per-channel rows, a
 *      day stamp, and history — the real flow, not a unit of a helper;
 *   4. the console API rejects unknown methods and bad settings patches.
 *
 * Run: node scripts/smoke.mjs   (exit 0 = pass, 1 = fail)
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

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

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-model-admin-smoke-'))
process.env.DSH_HOME = home

const entry = await import(new URL('../index.js', import.meta.url))
const { createApiRoutes, createCheckinEngine, createJsonStore, sanitizeSettings, Config, name, inject } = entry
const { createBridge } = await import(new URL('../src/rpc.js', import.meta.url))

console.log('\n[1] cordis contract')
check('plugin name is model-admin', () => assert.equal(name, 'dsh-model-admin'))
check('inject requires no host service (the console owns its own settings)', () => {
  assert.deepEqual(inject, [])
})
check('Config declares the three console fields', () => {
  assert.deepEqual(Object.keys(Config).sort(), ['autoCheckin', 'expiringWindowDays', 'runHour'])
})

console.log('\n[2] apply under a mock host, pack absent')
let apiRef = null
const mockCtx = createMockCtx()
const plugin = entry.apply(mockCtx, {})
apiRef = plugin.api
check('apply returns a status surface', () => {
  assert.equal(typeof plugin.state, 'function')
  const state = plugin.state()
  assert.equal(state.checkin.ranToday, false)
  assert.equal(state.settings.runHour, 9)
})
check('console API registered on the web server', () => {
  assert.ok(mockCtx.routes.has('/api/dsh-model-admin'))
})

console.log('\n[3] one check-in round over a mock Cordis service tree')
// The real pack registers Cordis services (not an RPC endpoint): a
// credentials resolver, an account pool, and one auth service per provider.
// Build that same tree so the check-in flow is exercised against the exact
// services production uses.
const makeAccounts = (provider, n) => Array.from({ length: n }, (_, i) => ({
  id: `${provider}-${i}`, provider, nickname: `${provider}-${i}`, enabled: true,
  credentialRef: `${provider.toUpperCase()}_REF_${i}`,
}))
const poolAccounts = {
  loomy: makeAccounts('loomy', 1),
  raccoon: makeAccounts('raccoon', 1),
  zcode: makeAccounts('zcode', 1),
}
const mockCredentials = {
  resolve: async ref => ({ value: JSON.stringify({ token: 'mock', ref }) }),
}
const mockPool = {
  listAccounts: async provider => poolAccounts[provider] ?? [],
  listAllAccounts: async () => Object.values(poolAccounts).flat(),
}
// loomy claims 300 credits; raccoon's one-time login reward and zcode's
// daily quota were already claimed.
const mockAuth = new Map([
  ['loomy', { claimDailyQuota: async () => ({ kind: 'claimed', credit: 300, streakDays: 0, isStreakDay: false }) }],
  ['raccoon', { claimLoginReward: async () => ({ kind: 'already-claimed', message: 'already' }) }],
  ['zcode', {
    claimDailyFor: async () => [{ kind: 'already-claimed', message: 'already' }],
    mintCaptcha: async () => ({}),
  }],
])
const checkinBridge = createBridge({
  services: () => ({ accountPool: mockPool, auth: mockAuth, credentials: mockCredentials }),
  warn: () => {},
})
const checkinStoreLocal = createJsonStore(path.join(home, 'dsh-model-admin', 'checkin.json'), {
  lastDate: '', lastResult: '', lastAt: 0, rows: [], history: [],
})
const checkinEngine = createCheckinEngine({
  store: checkinStoreLocal,
  bridge: checkinBridge,
  settings: () => ({ runHour: 9, expiringWindowDays: 15, autoCheckin: true }),
  logger: { info: () => {}, warn: () => {} },
})
const checkinApi = createApiRoutes({
  engine: checkinEngine,
  bridge: checkinBridge,
  settings: () => ({ runHour: 9, expiringWindowDays: 15, autoCheckin: true }),
  logger: { info: () => {}, warn: () => {} },
  version: entry.MODEL_ADMIN_VERSION,
})

const summary = await apiRef.handle('summary', {})
check('summary reports the pack state and channels', () => {
  assert.equal(summary.ok, true)
  assert.equal(summary.value.checkin.ranToday, false)
  assert.ok(summary.value.channels.length > 0)
  assert.equal(summary.value.version, entry.MODEL_ADMIN_VERSION)
})

const runResultEnv = await checkinApi.handle('runCheckin', {})
const runResult = runResultEnv.value
check('runCheckin produced rows and marked the day', () => {
  // Only loomy / raccoon / zcode have a claim endpoint; the rest are
  // excluded from the automatic list entirely.
  assert.equal(runResultEnv.ok, true)
  assert.equal(runResult.marked, true)
  assert.equal(runResult.totals.claimed, 1)
  assert.equal(runResult.totals.credit, 300)
  assert.equal(runResult.totals.alreadyClaimed, 2)
  const loomy = runResult.rows.find(r => r.channel === 'loomy')
  assert.equal(loomy.outcome, 'claimed')
  assert.equal(loomy.credit, 300)
  const raccoon = runResult.rows.find(r => r.channel === 'raccoon')
  assert.equal(raccoon.outcome, 'already')
  // Channels without a claim endpoint never get a row.
  assert.equal(runResult.rows.find(r => r.channel === 'gemini'), undefined)
  assert.equal(runResult.rows.find(r => r.channel === 'buddy'), undefined)
})
check('the day is stamped in the store', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(home, 'dsh-model-admin', 'checkin.json'), 'utf8'))
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(doc.lastDate))
  assert.equal(doc.rows.length, runResult.rows.length)
  assert.equal(doc.history.length, 1)
  assert.equal(doc.history[0].credit, 300)
})

const secondRunEnv = await checkinApi.handle('runCheckin', {})
const secondRun = secondRunEnv.value
check('a second run the same day is a no-op', () => {
  assert.equal(secondRun.alreadyRanToday, true)
  assert.equal(secondRun.marked, false)
})

console.log('\n[4] console API guards')
check('unknown method returns null (caller answers 404)', async () => {
  const result = await apiRef.handle('nope', {})
  assert.equal(result, null)
})
check('summary reports the route lane state', async () => {
  const s = await apiRef.handle('summary', {})
  assert.equal(s.value.route, true)
  assert.ok(Array.isArray(s.value.routes.entries))
  // No llm service in this composition: no captured channel, no entries.
  assert.equal(s.value.routes.count, 0)
})
check('settings patch drops junk and clamps ranges', () => {
  assert.deepEqual(sanitizeSettings({ runHour: 99, expiringWindowDays: -5, autoCheckin: 'yes' }), {
    runHour: 23, expiringWindowDays: 0,
  })
  assert.deepEqual(sanitizeSettings({ runHour: 7, autoCheckin: false }), { runHour: 7, autoCheckin: false })
})
check('updateSettings persists a valid patch', async () => {
  const result = await apiRef.handle('updateSettings', { runHour: 6 })
  assert.equal(result.ok, true)
  assert.equal(result.value.runHour, 6)
})

console.log('\n[5] accounts + balances relay')
check('accounts relays the pack list', async () => {
  const result = await apiRef.handle('accounts', { provider: 'buddy' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.accounts, [])
  assert.equal(result.value.provider, 'buddy')
})
check('a pack failure surfaces as ok:false with a capped message', async () => {
  mockCtx.connection.rpc.call = async () => ({ ok: false, error: { message: 'x'.repeat(500) } })
  const result = await apiRef.handle('balances', { provider: 'buddy' })
  assert.equal(result.ok, false)
  assert.ok(result.message.length <= 300)
})

console.log('\n[6] route preference RPC')
const setStrategy = await apiRef.handle('routeSetStrategy', { key: 'hy3', strategy: 'round-robin' })
check('routeSetStrategy persists a known strategy', () => {
  assert.equal(setStrategy.ok, true)
  assert.equal(setStrategy.value.strategy, 'round-robin')
})
const routesDoc = JSON.parse(fs.readFileSync(path.join(home, 'dsh-model-admin', 'routes.json'), 'utf8'))
check('the preference lands in the routes store', () => {
  assert.equal(routesDoc.routes.hy3.strategy, 'round-robin')
})
const badStrategy = await apiRef.handle('routeSetStrategy', { key: 'hy3', strategy: 'teleport' })
check('routeSetStrategy refuses an unknown strategy', () => {
  assert.equal(badStrategy.ok, false)
  assert.equal(badStrategy.error.code, 'BAD_REQUEST')
})
const pinned = await apiRef.handle('routeSetPinned', { key: 'hy3', pinned: ['trae', 'cline'] })
check('routeSetPinned stores the user order', () => {
  assert.equal(pinned.ok, true)
  assert.deepEqual(pinned.value.pinned, ['trae', 'cline'])
})
const badPin = await apiRef.handle('routeSetPinned', { key: '', pinned: [] })
check('routeSetPinned requires a key', () => {
  assert.equal(badPin.ok, false)
})
const disabled = await apiRef.handle('routeSetEnabled', { key: 'hy3', enabled: false })
check('routeSetEnabled hides a route from the catalog', () => {
  assert.equal(disabled.ok, true)
  assert.equal(disabled.value.enabled, false)
})
const badEnable = await apiRef.handle('routeSetEnabled', { key: 'hy3', enabled: 'yes' })
check('routeSetEnabled refuses a non-boolean', () => {
  assert.equal(badEnable.ok, false)
})
const cleared = await apiRef.handle('routeSetEnabled', { key: 'hy3', enabled: true })
check('re-enabling keeps the preference object', () => {
  assert.equal(cleared.value.enabled, true)
  const doc = JSON.parse(fs.readFileSync(path.join(home, 'dsh-model-admin', 'routes.json'), 'utf8'))
  assert.equal(doc.routes.hy3.strategy, 'round-robin')
})

console.log(`\n${failures.length === 0 ? 'SMOKE PASS' : `SMOKE FAIL (${failures.length}): ${failures.join(', ')}`}`)
fs.rmSync(home, { recursive: true, force: true })
process.exit(failures.length === 0 ? 0 : 1)

// ── mock host ────────────────────────────────────────────────────────────────

function createMockCtx() {
  const routes = new Map()
  const effects = []
  const connection = {
    rpc: {
      call: async () => ({ ok: true, value: [] }),
    },
  }
  return {
    routes,
    effects,
    connection,
    logger: { info: () => {}, warn: () => {} },
    get(service) {
      if (service === 'connection') return connection
      if (service === 'webServer') return {
        register: (spec) => routes.set(spec.path, spec.handler),
        registerRoute: (route, handler) => routes.set(route, handler),
      }
      return undefined
    },
    inject(services, fn) {
      // Run immediately with a scoped view over the same mock.
      const scoped = {
        get: service => this.get(service),
        effect: (fn, _label) => { effects.push(fn); return fn() },
      }
      // Cordis exposes injected services as properties on the scope.
      for (const svc of services) scoped[svc] = this.get(svc)
      fn(scoped)
    },
    effect(fn, _label) {
      effects.push(fn)
      return fn()
    },
  }
}
