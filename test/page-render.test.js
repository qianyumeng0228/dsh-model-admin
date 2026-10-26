import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The console page's render contract, exercised through the bundle itself.
 *
 * The browser half is a SINGLE-FILE ModuleLoader bundle: its `require` only
 * resolves host packages (`react`), never sibling files. So the components
 * are reached through `exports.__test`, and the stub `require` below THROWS
 * on anything but `react` — that throw is the regression gate for "did
 * somebody split the page back into its own module".
 *
 * Rendering is not simulated; the stub react records the element tree so a
 * check can assert structure and user-visible text.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const clientSource = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

const reactStub = {
  createElement: (type, props, ...children) => {
    const flat = children.flat(Infinity).filter(c => c !== null && c !== undefined && c !== false)
    return {
      type: typeof type === 'string' ? type : (type.name ?? 'Component'),
      props: { ...(props ?? {}), children: flat.length === 0 ? undefined : flat.length === 1 ? flat[0] : flat },
      children: flat,
    }
  },
  Fragment: 'Fragment',
  useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: fn => fn,
  useRef: value => ({ current: value }),
  useMemo: fn => fn(),
}

/** Load the bundle; any require other than `react` fails the check. */
function loadBundle() {
  let descriptor = null
  const window_ = { __ModuleLoader__: { load: d => { descriptor = d } } }
  const document_ = {
    head: { appendChild: () => {} },
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
  }
  new Function('window', 'document', clientSource)(window_, document_)
  assert.ok(descriptor !== null, 'the bundle must register itself')
  return descriptor.factory(name => {
    if (name === 'react') return reactStub
    throw new Error(`single-file contract violated: require('${name}')`)
  })
}

const bundle = loadBundle()
const {
  ModelAdminPage, Section, CheckinSection, RouteSection,
  AccountsSection, CreditsSection, BackupSection, formatAmount,
} = bundle.__test

const client = {
  summary: async () => ({
    pack: true,
    route: true,
    checkin: { ranToday: false, running: false, lastResult: '', rows: [] },
    channels: [{ id: 'buddy', name: 'CodeBuddy', checkin: 'daily' }],
    settings: { runHour: 9, autoCheckin: true },
    routes: { count: 0, entries: [] },
  }),
  runCheckin: async () => ({ ok: true }),
  accounts: async () => ({ accounts: [] }),
  balances: async () => ({ balances: [] }),
  exportBackup: async () => ({}),
  updateSettings: async () => ({}),
  call: async () => ({ entries: [], dispatch: [] }),
}

const shared = { client, busy: '', setBusy: () => {}, refresh: async () => {}, setError: () => {} }

test('the bundle never requires anything but react (single-file contract)', () => {
  // loadBundle() already ran the factory with a throwing require.
  assert.equal(typeof bundle.apply, 'function')
  assert.deepEqual(bundle.inject, ['slots', 'locale', 'connection'])
})

test('the shell renders five tabs and one tabpanel', () => {
  const tree = ModelAdminPage({ client })
  assert.equal(tree.props.className, 'dsh-model-admin')
  const tabs = tree.children.find(child => child.props?.role === 'tablist')
  assert.equal(tabs.children.length, 5)
  const panel = tree.children.find(child => child.props?.role === 'tabpanel')
  assert.ok(panel, 'a tabpanel exists')
})

test('every section builds its tree from the shared props', () => {
  const summary = {
    pack: true,
    route: true,
    checkin: { ranToday: true, lastResult: '1 个渠道领取（300 积分）', rows: [{ channel: 'buddy', outcome: 'claimed', credit: 300 }] },
    channels: [{ id: 'buddy', name: 'CodeBuddy', checkin: 'daily' }],
    settings: { runHour: 9, autoCheckin: true },
    routes: { count: 1, entries: [] },
  }
  for (const Component of [CheckinSection, RouteSection, AccountsSection, CreditsSection, BackupSection]) {
    const tree = Component({ ...shared, summary })
    assert.equal(typeof tree, 'object', Component.name)
    assert.ok(tree.props !== undefined, Component.name)
  }
})

test('the section router maps each tab id to its component', () => {
  const summary = { pack: true, route: true, checkin: { rows: [] }, channels: [], settings: {} }
  for (const [tab, name] of [
    ['checkin', 'CheckinSection'],
    ['route', 'RouteSection'],
    ['accounts', 'AccountsSection'],
    ['credits', 'CreditsSection'],
    ['backup', 'BackupSection'],
  ]) {
    const tree = Section({ tab, ...shared, summary })
    assert.equal(tree.type, name, `tab ${tab}`)
  }
})

test('the check-in section marks the day as already run', () => {
  const tree = CheckinSection({
    ...shared,
    summary: { checkin: { ranToday: true, lastResult: 'done', rows: [] }, settings: { runHour: 9, autoCheckin: true } },
  })
  const texts = collectText(tree)
  assert.ok(texts.some(text => text.includes('今日已运行')), texts.join('|'))
  assert.ok(texts.some(text => text.includes('今日已跑')), texts.join('|'))
})

test('the route section states why it is empty instead of showing nothing', () => {
  const tree = RouteSection({ ...shared, summary: { route: true } })
  const texts = collectText(tree)
  assert.ok(texts.some(text => text.includes('同一个模型在多个渠道')), texts.join('|'))
})

test('the accounts section lists every channel row', () => {
  const tree = AccountsSection({
    ...shared,
    summary: { channels: [{ id: 'buddy' }, { id: 'trae' }, { id: 'qoder' }] },
  })
  const texts = collectText(tree)
  for (const id of ['buddy', 'trae', 'qoder']) assert.ok(texts.includes(id), id)
})

test('the credits section lists every channel row', () => {
  const tree = CreditsSection({
    ...shared,
    summary: { channels: [{ id: 'buddy' }, { id: 'zcode' }] },
  })
  const texts = collectText(tree)
  for (const id of ['buddy', 'zcode']) assert.ok(texts.includes(id), id)
})

test('the backup section warns about the archive contents', () => {
  const texts = collectText(BackupSection(shared))
  assert.ok(texts.some(text => text.includes('敏感信息')), texts.join('|'))
})

test('formatAmount survives the inlining with the same rules', () => {
  assert.equal(formatAmount(5_000_000_000), '5B')
  assert.equal(formatAmount(12_500_000), '12.5M')
  assert.equal(formatAmount(999), '999')
  assert.equal(formatAmount(Number.NaN), '0')
})

/**
 * Every user-visible string in an element tree.
 *
 * Walks children AND element-valued props: sections hand chrome through
 * props (`action`, `label`), and those subtrees carry text too.
 */
function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, out)
    return out
  }
  if (typeof node !== 'object') return out
  for (const child of node.children ?? []) collectText(child, out)
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (key === 'children') continue
    if (typeof value === 'string') {
      out.push(value)
      continue
    }
    if (value !== null && typeof value === 'object') collectText(value, out)
  }
  return out
}
