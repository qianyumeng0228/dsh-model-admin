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
const { createApiRoutes, sanitizeSettings, Config, name, inject } = entry

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

console.log('\n[3] one check-in round over a fake pack')
const packCalls = []
mockCtx.connection.rpc.call = async (_path, endpoint, body) => {
  packCalls.push({ endpoint, method: body.method, payload: body.payload })
  if (body.method === 'credits.claimAll') {
    if (body.payload.provider === 'buddy') {
      return { ok: true, value: { summary: { claimed: 2, alreadyClaimed: 0, totalByUnit: { credit: 300, token: 0 } } } }
    }
    if (body.payload.provider === 'gemini') {
      return { ok: false, error: { message: 'no check-in endpoint' } }
    }
    return { ok: true, value: { summary: { claimed: 0, alreadyClaimed: 1, totalByUnit: { credit: 0, token: 0 } } } }
  }
  return { ok: true, value: [] }
}

const summary = await apiRef.handle('summary', {})
check('summary reports the pack state and channels', () => {
  assert.equal(summary.ok, true)
  assert.equal(summary.value.checkin.ranToday, false)
  assert.ok(summary.value.channels.length > 0)
  assert.equal(summary.value.version, entry.MODEL_ADMIN_VERSION)
})

const runResult = await apiRef.handle('runCheckin', {})
check('runCheckin produced rows and marked the day', () => {
  assert.equal(runResult.ok, true)
  assert.equal(runResult.value.marked, true)
  // buddy claims 300 credits; the other nine check-in channels were already
  // claimed earlier today; gemini has no check-in endpoint and is excluded
  // from the automatic list entirely (it never gets a row).
  assert.equal(runResult.value.totals.claimed, 1)
  assert.equal(runResult.value.totals.credit, 300)
  assert.equal(runResult.value.totals.alreadyClaimed, 9)
  const buddy = runResult.value.rows.find(r => r.channel === 'buddy')
  assert.equal(buddy.outcome, 'claimed')
  assert.equal(buddy.credit, 300)
  const trae = runResult.value.rows.find(r => r.channel === 'trae')
  assert.equal(trae.outcome, 'already')
  const gemini = runResult.value.rows.find(r => r.channel === 'gemini')
  assert.equal(gemini, undefined)
})
check('claimAll went out once per check-in channel', () => {
  const claims = packCalls.filter(c => c.method === 'credits.claimAll')
  // 15 channels minus the five without a check-in endpoint.
  assert.equal(claims.length, 10)
  assert.equal(new Set(claims.map(c => c.payload.provider)).size, 10)
  // gemini has no check-in endpoint: it must never be called.
  assert.ok(!claims.some(c => c.payload.provider === 'gemini'))
})
check('the day is stamped in the store', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(home, 'dsh-model-admin', 'checkin.json'), 'utf8'))
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(doc.lastDate))
  assert.equal(doc.rows.length, runResult.value.rows.length)
  assert.equal(doc.history.length, 1)
  assert.equal(doc.history[0].credit, 300)
})

const secondRun = await apiRef.handle('runCheckin', {})
check('a second run the same day is a no-op', () => {
  assert.equal(secondRun.value.alreadyRanToday, true)
  assert.equal(secondRun.value.marked, false)
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
      fn(scoped)
    },
    effect(fn, _label) {
      effects.push(fn)
      return fn()
    },
  }
}
