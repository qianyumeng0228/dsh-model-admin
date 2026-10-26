/**
 * Model Admin — plugin entry (Host half).
 *
 * Wiring: the vendored channel pack on a fiber of its own, one RPC bridge in
 * front of it, the daily check-in scheduler, and the browser-facing JSON API
 * the console reads. The plugin registers NO provider and NO model route —
 * account and check-in management is its whole surface, so installing it
 * cannot change which model a conversation uses.
 *
 * Every harness facility is reached through `ctx`, and only the ones the
 * plugin cannot work without are declared in `inject`. A composition without
 * a web server keeps the check-in scheduler (host-side) and loses only the
 * console; a composition without the pack degrades every RPC to
 * `PACK_UNAVAILABLE` and the console says why, instead of showing an empty
 * account list that reads as "you have no accounts".
 *
 * Data layout (under `~/.dsh/dsh-model-admin/`):
 *   settings.json  console preferences (schedule hour, expiring window)
 *   checkin.json   last run date, per-channel outcome rows, history
 *   backup/        credential exports the user asked for
 */

import fs from 'node:fs'
import path from 'node:path'
import { createBridge } from './src/rpc.js'
import { autoCheckinChannelIds, channelOf } from './src/channels.js'
import { RouteAdapter, ROUTE_PROVIDER_ID, ROUTE_MODEL_PREFIX, captureAdapters } from './src/route/adapter.js'
import {
  utc8DateString, ranToday, shouldMarkToday, delayUntilHourUtc8, msUntilNextUtc8Midnight,
} from './src/schedule.js'
import { summarize, describeRun } from './src/runs.js'

/** Cordis plugin name; also the settings namespace the host serves. */
export const name = 'dsh-model-admin'

export const MODEL_ADMIN_VERSION = '0.1.0'

/** Directory name under the DSH home. */
export const DATA_DIR_NAME = 'dsh-model-admin'

/** Default local hour (UTC+8) the daily run fires at. */
export const DEFAULT_RUN_HOUR = 9

/**
 * Services this plugin cannot work without.
 *
 * Empty on purpose: the console keeps its own `settings.json` and never
 * touches the host's `settings` service, so no composition has to be
 * degraded for this plugin to load. Everything else (webServer, llm,
 * connection, credentials) is injected optionally inside `apply` — a host
 * without them loses the console or the channels, not the check-in engine.
 */
export const inject = []

/**
 * Console preferences, defaulted here and persisted to `settings.json`.
 *
 * Plain data, not a schemastery schema: the host does not parse this object
 * (the field names are informational), and the console UI is the only
 * writer. `sanitizeSettings()` is the free function that clamps what the UI
 * sends.
 */
export const Config = {
  /** Hour 0–23 (UTC+8) the daily check-in fires at. */
  runHour: { type: 'number', default: DEFAULT_RUN_HOUR },
  /** Days within which a credit pack counts as "expiring". */
  expiringWindowDays: { type: 'number', default: 15 },
  /** Run the daily check-in automatically. */
  autoCheckin: { type: 'boolean', default: true },
}

// ── the JSON store ───────────────────────────────────────────────────────────

/**
 * A tiny JSON document store: read-modify-write with an atomic rename, so a
 * crash mid-write cannot truncate the file the next boot reads.
 *
 * @param {string} filePath
 * @param {object} fallback returned (and seeded) when the file is absent or unreadable
 */
function createJsonStore(filePath, fallback) {
  return {
    path: filePath,
    /** @returns {any} */
    load() {
      try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'))
      } catch {
        return structuredCloneish(fallback)
      }
    },
    /** @param {any} doc */
    save(doc) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      const tmp = `${filePath}.tmp`
      fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 })
      fs.renameSync(tmp, filePath)
    },
  }
}

function structuredCloneish(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

/** Whether a file URL resolves to a real file (the vendored pack, today). */
function existsSync(fileUrl) {
  try {
    return fs.statSync(fileUrl).isFile()
  } catch {
    return false
  }
}

// ── the check-in engine ──────────────────────────────────────────────────────

/**
 * One channel's outcome row for a run.
 * @typedef {{channel: string, outcome: 'claimed'|'already'|'skipped'|'failed'|'inactive', credit?: number, token?: number, message?: string}} RunRow
 */

/** Messages that mean "this channel has no check-in endpoint" upstream. */
const UNSUPPORTED_PATTERNS = [
  'no check', 'not supported', 'unsupported', '无签到', '不支持签到', 'not active', '未开启',
]

/**
 * The daily check-in engine: sequential per channel, one outcome row each,
 * and a stored day stamp that only advances when the run accomplished
 * something. Serial by design — firing every channel at once is the fastest
 * way to trip an upstream volume limit and burn the day.
 */
function createCheckinEngine({ store, bridge, settings, logger }) {
  let running = false

  /** @returns {{enabled: boolean, lastDate: string, ranToday: boolean, running: boolean, lastResult: string, lastAt: number, rows: RunRow[]}} */
  function state(nowMs = Date.now()) {
    const doc = store.load()
    return {
      enabled: settings().autoCheckin !== false,
      lastDate: doc.lastDate ?? '',
      ranToday: ranToday(doc.lastDate ?? '', nowMs),
      running,
      lastResult: doc.lastResult ?? '',
      lastAt: doc.lastAt ?? 0,
      rows: Array.isArray(doc.rows) ? doc.rows : [],
    }
  }

  /**
   * Run every channel that has a check-in endpoint, one at a time.
   * @returns {Promise<{rows: RunRow[], totals: object, marked: boolean}>}
   */
  async function run(nowMs = Date.now()) {
    if (running) return { rows: state(nowMs).rows, totals: summarize(state(nowMs).rows), marked: false }
    running = true
    /** @type {RunRow[]} */
    const rows = []
    try {
      const ids = autoCheckinChannelIds()
      for (const [index, channel] of ids.entries()) {
        if (index > 0) await sleep(400)
        rows.push(await runChannel(channel, nowMs))
      }
    } finally {
      running = false
    }

    const totals = summarize(rows)
    const marked = shouldMarkToday(totals)
    if (marked) {
      store.save({
        lastDate: utc8DateString(nowMs),
        lastResult: describeRun(rows),
        lastAt: nowMs,
        rows,
        history: appendHistory(store.load().history, nowMs, describeRun(rows), totals),
      })
      logger.info?.(`dsh-model-admin: check-in complete (${utc8DateString(nowMs)}): ${describeRun(rows)}`)
    } else {
      logger.warn?.(`dsh-model-admin: check-in collected nothing today; not marking the day (${describeRun(rows)})`)
    }
    return { rows, totals, marked }
  }

  /**
   * One channel. `credits.claimAll` already covers "check status, claim if
   * due, report what happened" server-side per account, so the console asks
   * once per channel and reads the summary back.
   */
  async function runChannel(channel, nowMs) {
    const row = { channel, outcome: 'failed' }
    const pack = channelOf(channel)
    if (pack === undefined) {
      row.outcome = 'skipped'
      row.message = 'unknown channel'
      return row
    }
    if (pack.checkin === 'none') {
      row.outcome = 'skipped'
      row.message = '该渠道无签到接口'
      return row
    }
    const result = await bridge.call('credits.claimAll', { provider: channel }, { timeoutMs: 120_000 })
    if (!result.ok) {
      if (isUnsupportedCheckin(result.message)) {
        row.outcome = 'skipped'
        row.message = '该渠道无签到接口'
      } else if (result.code === 'PACK_UNAVAILABLE') {
        row.outcome = 'failed'
        row.message = '渠道包未挂载'
      } else {
        row.outcome = 'failed'
        row.message = result.message
      }
      return row
    }
    const summary = result.value?.summary ?? result.value
    if (summary === undefined || summary === null) {
      row.outcome = 'skipped'
      row.message = '无可领取'
      return row
    }
    const claimed = Number(summary.claimed) || 0
    const already = Number(summary.alreadyClaimed) || 0
    const inactive = Number(summary.inactive) || 0
    const failed = Number(summary.failed) || 0
    if (claimed > 0) {
      row.outcome = 'claimed'
      const byUnit = summary.totalByUnit ?? {}
      row.credit = Number(byUnit.credit) || 0
      row.token = Number(byUnit.token) || 0
    } else if (already > 0) {
      row.outcome = 'already'
    } else if (inactive > 0 && claimed === 0 && already === 0 && failed === 0) {
      row.outcome = 'inactive'
    } else if (failed > 0) {
      row.outcome = 'failed'
      row.message = '上游报告失败'
    } else {
      row.outcome = 'skipped'
      row.message = '无可领取'
    }
    void nowMs
    return row
  }

  return { state, run, isRunning: () => running }
}

function isUnsupportedCheckin(message) {
  const text = String(message ?? '').toLowerCase()
  return UNSUPPORTED_PATTERNS.some(pattern => text.includes(pattern.toLowerCase()))
}

/**
 * Pause between channels. Deliberately NOT `unref`'d: this wait sits inside
 * an awaited chain, and an unref'd timer does not keep the event loop
 * alive — on a host with nothing else scheduled (a headless composition, or
 * a test) the process would simply exit mid-run. The run finishing is what
 * releases the loop, not this timer.
 */
function sleep(ms) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/** Keep at most the last 30 daily summaries. */
function appendHistory(history, at, text, totals) {
  const rows = Array.isArray(history) ? history : []
  const entry = {
    at,
    date: utc8DateString(at),
    text,
    credit: totals?.credit ?? 0,
    token: totals?.token ?? 0,
    claimed: totals?.claimed ?? 0,
  }
  return [...rows, entry].slice(-30)
}

// ── the browser-facing API ───────────────────────────────────────────────────

/**
 * The console's read/write surface, served over the host's web server as
 * JSON. Fixed paths only, and every response is the same envelope
 * `{ ok, value }` / `{ ok: false, error: { code, message } }` so the client
 * has exactly one error path.
 */
export function createApiRoutes({ engine, bridge, settings, logger, version = MODEL_ADMIN_VERSION, route }) {
  /** @type {Record<string, (body: any) => Promise<any>} */
  const handlers = {
    /** Everything the console needs on mount, in one round trip. */
    async summary() {
      const pack = bridge.available()
      const channels = autoCheckinChannelIds().map(id => {
        const row = channelOf(id)
        return { id, name: row.name, checkin: row.checkin }
      })
      let routes = { count: 0, entries: [] }
      if (route !== undefined) {
        try {
          const listed = await route.adapter.refresh()
          routes = {
            count: listed.length,
            entries: listed.slice(0, 50).map(entry => ({
              key: entry.key,
              name: entry.name,
              candidates: entry.candidates.length,
              strategy: entry.strategy,
            })),
          }
        } catch {
          routes = { count: 0, entries: [] }
        }
      }
      return {
        version,
        pack,
        route: route !== undefined,
        routes,
        checkin: engine.state(),
        channels,
        settings: settings(),
        nextRunInMs: msUntilNextUtc8Midnight(Date.now()),
      }
    },

    /** Run the daily check-in now. */
    async runCheckin() {
      const before = engine.state()
      if (before.ranToday) {
        return { rows: before.rows, totals: summarize(before.rows), marked: false, alreadyRanToday: true }
      }
      const outcome = await engine.run()
      return { ...outcome, alreadyRanToday: false }
    },

    /** Latest stored state (used by the panel's poller). */
    async checkinState() {
      return engine.state()
    },

    /** Accounts of one channel, normalized for display. */
    async accounts(body) {
      const provider = String(body?.provider ?? '')
      const result = await bridge.call('account.list', { provider })
      if (!result.ok) return result
      const accounts = Array.isArray(result.value) ? result.value : result.value?.accounts ?? []
      return { ok: true, value: { provider, accounts } }
    },

    /** Credit balances of one channel's accounts. */
    async balances(body) {
      const provider = String(body?.provider ?? '')
      const result = await bridge.call('credits.balances', { provider })
      if (!result.ok) return result
      return { ok: true, value: { provider, balances: result.value?.balances ?? result.value ?? [] } }
    },

    /**
     * Begin a login: reserve a placeholder account and return the URL the user
     * opens in their browser. The browser half then polls `pollLogin` until the
     * credential lands. Mirrors the pack's `account.create`; extra fields
     * (e.g. `zcodeProvider`) are passed through untouched.
     */
    async createAccount(body) {
      const provider = String(body?.provider ?? '')
      if (provider === '') return { ok: false, error: { code: 'BAD_REQUEST', message: 'provider is required' } }
      const { provider: _omit, ...extra } = body ?? {}
      return bridge.call('account.create', { provider, ...extra }, { timeoutMs: 90_000 })
    },

    /** Poll a pending login until the pack sees the credential. */
    async pollLogin(body) {
      const provider = String(body?.provider ?? '')
      const accountId = String(body?.accountId ?? '')
      if (provider === '' || accountId === '') {
        return { ok: false, error: { code: 'BAD_REQUEST', message: 'provider and accountId are required' } }
      }
      return bridge.call('login.poll', { accountId, provider })
    },

    /** Claim one channel's daily reward immediately. */
    async claim(body) {
      const provider = String(body?.provider ?? '')
      return bridge.call('credits.claimAll', { provider }, { timeoutMs: 120_000 })
    },

    /** Export credentials (the pack writes the archive; we only relay). */
    async exportBackup() {
      return bridge.call('backup.export', {}, { timeoutMs: 120_000 })
    },

    /** Update console preferences. */
    async updateSettings(body) {
      const next = sanitizeSettings(body)
      settings.update(next)
      settings.flush()
      return { ok: true, value: settings() }
    },
  }

  // ── the routing lane's surface ─────────────────────────────────────────────
  /**
   * Route handlers are attached when the caller supplies the route lane
   * (`route: { adapter, prefs, mutate, stats }`). Kept in a separate block
   * so a composition without the llm service simply has no route methods
   * instead of failing the whole console.
   */
  if (route !== undefined) {
    handlers.routes = async () => {
      const entries = await route.adapter.refresh()
      return {
        entries: entries.map(entry => ({
          key: entry.key,
          name: entry.name,
          strategy: entry.strategy,
          pinned: entry.pinned,
          candidates: entry.candidates.map(c => ({
            channel: c.channel,
            model: c.model,
            ...c.name === undefined ? {} : { name: c.name },
          })),
          contextWindow: entry.contextWindow,
          maxTokens: entry.maxTokens,
          inputModalities: entry.inputModalities,
        })),
        dispatch: route.stats(),
      }
    }
    handlers.routeSetStrategy = async body => {
      const key = String(body?.key ?? '')
      const strategy = String(body?.strategy ?? '')
      if (key === '' || !['fallback', 'round-robin', 'sticky'].includes(strategy)) {
        return { ok: false, error: { code: 'BAD_REQUEST', message: 'key and a known strategy are required' } }
      }
      route.mutate(key, { strategy })
      return { ok: true, value: route.prefs()[key] }
    }
    handlers.routeSetPinned = async body => {
      const key = String(body?.key ?? '')
      const pinned = Array.isArray(body?.pinned) ? body.pinned.map(String) : []
      if (key === '') return { ok: false, error: { code: 'BAD_REQUEST', message: 'key is required' } }
      route.mutate(key, { pinned })
      return { ok: true, value: route.prefs()[key] }
    }
    handlers.routeSetEnabled = async body => {
      const key = String(body?.key ?? '')
      if (key === '' || typeof body?.enabled !== 'boolean') {
        return { ok: false, error: { code: 'BAD_REQUEST', message: 'key and a boolean enabled are required' } }
      }
      route.mutate(key, { enabled: body.enabled })
      return { ok: true, value: route.prefs()[key] }
    }
  }

  /**
   * Route one request. Returns null when no handler matches, so the caller
   * can answer 404 itself.
   *
   * Every answer is one envelope — `{ ok: true, value }` or
   * `{ ok: false, error: { code, message } }` — because two handler styles
   * meet here: the console's own handlers return bare values, while the
   * pack-relaying ones (`accounts`, `balances`, `claim`, `exportBackup`)
   * already answer in the bridge's envelope. Normalizing here means the
   * HTTP route and every in-process caller have exactly one shape to read.
   *
   * @param {string} method
   * @param {any} body
   */
  async function handle(method, body) {
    const handler = handlers[String(method ?? '')]
    if (handler === undefined) return null
    try {
      const result = await handler(body ?? {})
      if (result !== null && typeof result === 'object' && typeof result.ok === 'boolean') {
        return result
      }
      return { ok: true, value: result }
    } catch (error) {
      logger.warn?.(`dsh-model-admin api ${method} failed: ${String(error?.message ?? error)}`)
      return { ok: false, error: { code: 'INTERNAL', message: String(error?.message ?? error).slice(0, 300) } }
    }
  }

  return { handle, handlers: Object.keys(handlers) }
}

/** Coerce a settings patch to the declared shape; junk is dropped, not stored. */
export function sanitizeSettings(patch) {
  /** @type {Record<string, any>} */
  const out = {}
  if (Number.isFinite(Number(patch?.runHour))) {
    const hour = Math.min(23, Math.max(0, Math.trunc(Number(patch.runHour))))
    out.runHour = hour
  }
  if (Number.isFinite(Number(patch?.expiringWindowDays))) {
    out.expiringWindowDays = Math.min(365, Math.max(0, Math.trunc(Number(patch.expiringWindowDays))))
  }
  if (typeof patch?.autoCheckin === 'boolean') out.autoCheckin = patch.autoCheckin
  return out
}

// ── the plugin ───────────────────────────────────────────────────────────────

/**
 * @param {any} ctx cordis context
 * @param {any} config live settings section
 */
export function apply(ctx, config) {
  const logger = ctx.logger ?? console
  const home = resolveDshHome()
  const dataDir = path.resolve(home, DATA_DIR_NAME)
  fs.mkdirSync(dataDir, { recursive: true })

  const settingsStore = createJsonStore(path.join(dataDir, 'settings.json'), {
    runHour: DEFAULT_RUN_HOUR,
    expiringWindowDays: 15,
    autoCheckin: true,
  })
  const checkinStore = createJsonStore(path.join(dataDir, 'checkin.json'), {
    lastDate: '',
    lastResult: '',
    lastAt: 0,
    rows: [],
    history: [],
  })

  const settings = () => {
    const doc = settingsStore.load()
    return {
      runHour: Number.isFinite(doc.runHour) ? doc.runHour : DEFAULT_RUN_HOUR,
      expiringWindowDays: Number.isFinite(doc.expiringWindowDays) ? doc.expiringWindowDays : 15,
      autoCheckin: doc.autoCheckin !== false,
    }
  }
  const updateSettings = patch => {
    settingsStore.save({ ...settingsStore.load(), ...patch })
  }
  const flushSettings = () => {}

  /**
   * The pack is mounted on a scoped fiber so a composition without the
   * services it needs (a headless TUI) still loads this plugin and keeps
   * the scheduler; only the channels degrade.
   *
   * Two ways the mount is skipped, both deliberate: `MODEL_ADMIN_NO_PACK=1`
   * in the launching environment (tests, and an operator who manages
   * WorkBuddy accounts through `dsh-connect-workbuddy` and wants no second
   * channel stack), and a missing vendored pack (a trimmed install). In
   * both cases the console reports the reason instead of an empty list.
   */
  let packState = { state: 'pending', error: '' }
  const bridge = createBridge({
    connection: () => {
      try {
        return ctx.get?.('connection') ?? null
      } catch {
        return null
      }
    },
    warn: message => logger.warn?.(message),
  })

  // ── the routing lane ───────────────────────────────────────────────────────
  /**
   * The route captures every adapter the host registers from here on — the
   * channel pack's ten channels land in this map while it mounts, and the
   * route reuses their own `prepareCall` instead of re-implementing any
   * channel's protocol. Installed BEFORE the pack mounts for that reason;
   * with the pack absent the map stays empty and the route offers nothing.
   */
  const capturedAdapters = new Map()
  const restoreCapture = captureAdapters(ctx, capturedAdapters)
  const routeStore = createJsonStore(path.join(dataDir, 'routes.json'), { routes: {} })
  const dispatchStats = new Map()
  const routeAdapter = new RouteAdapter({
    adapters: () => capturedAdapters,
    llm: () => { try { return ctx.get?.('llm') } catch { return undefined } },
    routes: () => routeStore.load().routes ?? {},
    onDispatch: (entry, candidate) => {
      const key = `${entry.key}\0${candidate.channel}`
      const row = dispatchStats.get(key) ?? { model: entry.key, channel: candidate.channel, turns: 0, lastAt: 0 }
      row.turns += 1
      row.lastAt = Date.now()
      dispatchStats.set(key, row)
    },
    logger,
  })

  let routeRegistration = null
  ctx.inject(['llm'], scoped => {
    const llm = scoped.get?.('llm')
    if (llm === undefined || typeof llm.registerAdapter !== 'function') return
    try {
      routeRegistration = llm.registerAdapter([ROUTE_PROVIDER_ID], routeAdapter)
      logger.info?.('dsh-model-admin: route provider registered')
    } catch (error) {
      logger.warn?.(`dsh-model-admin: route provider registration failed: ${String(error?.message ?? error)}`)
    }
  })

  const packDisabled = process.env.MODEL_ADMIN_NO_PACK === '1'
  const packFile = new URL('./vendor/channel-pack/pack.js', import.meta.url)
  if (packDisabled || !existsSync(packFile)) {
    packState = packDisabled
      ? { state: 'disabled', error: 'MODEL_ADMIN_NO_PACK=1' }
      : { state: 'failed', error: 'vendored channel pack is missing' }
    logger.warn?.(`dsh-model-admin: channel pack not mounted (${packState.error})`)
  } else {
    ctx.inject(['connection', 'credentials', 'llm'], scoped => {
      let stopped = false
      scoped.effect(() => () => { stopped = true }, 'dsh-model-admin: channel pack')
      void import('./vendor/channel-pack/pack.js')
        .then(pack => {
          if (stopped) return
          pack.apply(scoped, {})
          packState = { state: 'ready', error: '' }
          logger.info?.('dsh-model-admin: channel pack mounted (10 account channels)')
        })
        .catch(error => {
          if (stopped) return
          packState = { state: 'failed', error: String(error?.message ?? error).slice(0, 300) }
          logger.warn?.(`dsh-model-admin: channel pack unavailable (${packState.error})`)
        })
    })
  }

  const engine = createCheckinEngine({
    store: checkinStore,
    bridge,
    settings,
    logger,
  })

  // The routing lane's console surface: one mutate point for every route
  // preference, so the panel cannot write two halves of one preference.
  const routeLane = {
    adapter: routeAdapter,
    prefs: () => routeStore.load().routes ?? {},
    stats: () => [...dispatchStats.values()].sort((a, b) => b.turns - a.turns).slice(0, 100),
    mutate: (key, patch) => {
      const doc = routeStore.load()
      const routes = { ...doc.routes }
      const current = routes[key] ?? {}
      const next = { ...current, ...patch }
      // An empty preference object is the default state; drop it so the
      // file does not grow one dead key per model the user ever touched.
      if (Object.keys(next).length === 0) delete routes[key]
      else routes[key] = next
      routeStore.save({ ...doc, routes })
    },
  }

  const api = createApiRoutes({
    engine,
    bridge,
    settings,
    logger,
    version: MODEL_ADMIN_VERSION,
    route: routeLane,
  })

  // Serve the console API under the host's web server when one exists.
  ctx.inject(['webServer'], scoped => {
    const server = scoped.get?.('webServer')
    if (server === undefined || typeof server.registerRoute !== 'function') return
    server.registerRoute('/api/dsh-model-admin', async request => {
      const body = await readJsonBody(request)
      const result = await api.handle(body?.method ?? request.method, body)
      if (result === null) return jsonResponse(404, { ok: false, error: { code: 'NOT_FOUND', message: 'unknown method' } })
      return jsonResponse(200, result)
    })
    logger.info?.('dsh-model-admin: console API served at /api/dsh-model-admin')
  })

  // ── the daily scheduler ────────────────────────────────────────────────────
  /**
   * One timer per day: fire at the configured UTC+8 hour, run, then schedule
   * the next midnight. The timer is unref'd so it never holds the process
   * open, and every tick re-reads settings so an hour change applies
   * without a restart.
   */
  let timer = null
  function scheduleNext() {
    if (timer !== null) clearTimeout(timer)
    if (settings().autoCheckin !== true) return
    const now = Date.now()
    const state = engine.state(now)
    // Missed while the app was closed: run once at startup, then schedule.
    const delay = state.ranToday
      ? msUntilNextUtc8Midnight(now)
      : delayUntilHourUtc8(settings().runHour, now)
    timer = setTimeout(async () => {
      timer = null
      try {
        if (!engine.state().ranToday) await engine.run()
      } catch (error) {
        logger.warn?.(`dsh-model-admin: scheduled check-in failed: ${String(error?.message ?? error)}`)
      }
      scheduleNext()
    }, Math.max(0, delay))
    timer.unref?.()
    logger.info?.(`dsh-model-admin: next check-in in ${Math.round(delay / 60000)} min`)
  }
  scheduleNext()

  // Catch-up: a run missed while the host was down happens on the next
  // start, not at the configured hour. The timer is NOT unref'd on purpose:
  // a catch-up run is work the user asked for, and an unref'd timer would
  // let an otherwise-idle host exit before it fires.
  if (settings().autoCheckin === true && !engine.state().ranToday) {
    setTimeout(() => {
      void engine.run().catch(error => {
        logger.warn?.(`dsh-model-admin: catch-up check-in failed: ${String(error?.message ?? error)}`)
      })
    }, 30_000)
  }

  ctx.effect(() => () => {
    if (timer !== null) clearTimeout(timer)
    try {
      routeRegistration?.()
    } catch { /* a registration already released by the host */ }
    try {
      restoreCapture()
    } catch { /* the wrap was never installed */ }
    logger.info?.('dsh-model-admin: stopped')
  }, 'dsh-model-admin: lifecycle')

  // Console-facing status for /summary-style diagnostics.
  return {
    state: () => ({
      ...packState,
      checkin: engine.state(),
      settings: settings(),
      route: { provider: ROUTE_PROVIDER_ID, channels: capturedAdapters.size },
    }),
    api,
    version: MODEL_ADMIN_VERSION,
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv
  return path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh')
}

async function readJsonBody(request) {
  try {
    if (typeof request?.json === 'function') return await request.json()
    const chunks = []
    for await (const chunk of request ?? []) chunks.push(chunk)
    if (chunks.length === 0) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

function jsonResponse(status, payload) {
  const body = JSON.stringify(payload)
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export { DATA_DIR_NAME as dataDirName }
export default apply
