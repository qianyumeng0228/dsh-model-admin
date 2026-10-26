import { test } from 'node:test'
import assert from 'node:assert/strict'

/**
 * The console page's render contract, exercised with the stubbed react
 * (see test/stubs/react.mjs, wired by the loader): the module graph loads
 * and every section builds its element tree from a realistic summary.
 * Rendering itself is the shell's job; what this guards is the shape the
 * host will receive — tab count, section routing, and that a section never
 * crashes on the empty/zero state.
 */

const { ModelAdminPage } = await import('../src/client/page.js')
const {
  CheckinSection, RouteSection, AccountsSection, CreditsSection, BackupSection,
} = await import('../src/client/sections.js')

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
  for (const Section of [CheckinSection, RouteSection, AccountsSection, CreditsSection, BackupSection]) {
    const tree = Section({ ...shared, summary })
    assert.equal(typeof tree, 'object', Section.name)
    assert.ok(tree.props !== undefined, Section.name)
  }
})

test('the check-in section marks the day as already run', () => {
  const tree = CheckinSection({
    ...shared,
    summary: { checkin: { ranToday: true, lastResult: 'done', rows: [] }, settings: { runHour: 9, autoCheckin: true } },
  })
  // The run button's label comes from state; find it by walking the tree.
  const texts = collectText(tree)
  assert.ok(texts.some(text => text.includes('今日已运行')), texts.join('|'))
  assert.ok(texts.some(text => text.includes('今日已跑')), texts.join('|'))
})

test('the route section states why it is empty instead of showing nothing', async () => {
  // No channels -> the section says so. Rendered synchronously here; the
  // data read happens in an effect, so the empty-state text is what shows
  // on first paint.
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
  assert.ok(texts.includes('buddy'))
  assert.ok(texts.includes('trae'))
  assert.ok(texts.includes('qoder'))
})

test('the credits section lists every channel row', () => {
  const tree = CreditsSection({
    ...shared,
    summary: { channels: [{ id: 'buddy' }, { id: 'zcode' }] },
  })
  const texts = collectText(tree)
  assert.ok(texts.includes('buddy'))
  assert.ok(texts.includes('zcode'))
})

test('the backup section warns about the archive contents', () => {
  const tree = BackupSection(shared)
  const texts = collectText(tree)
  assert.ok(texts.some(text => text.includes('敏感信息')), texts.join('|'))
})

/**
 * Every string leaf in an element tree.
 *
 * Walks children AND element-valued props: a section hands chrome through
 * props (`action`, `label`), and those subtrees carry user-visible text too.
 * Functions and plain data are skipped — only elements and strings recurse.
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
      // A plain string prop is data (className, type), not a child — but a
      // section's `title` IS user-visible, so collect it too.
      out.push(value)
      continue
    }
    if (value !== null && typeof value === 'object') collectText(value, out)
  }
  return out
}
