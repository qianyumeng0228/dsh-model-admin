/**
 * The console panel — four sections over the plugin's own API client.
 *
 * Rendering is plain DOM on purpose: the panel ships inside the plugin, and
 * every UI framework it pulled in would become a peer dependency of every
 * installation. State is one object per section, refreshed by explicit
 * calls, so a failed refresh never leaves a half-drawn list.
 *
 * Outcome vocabulary (shared with the host half):
 *   claimed   reward collected this run
 *   already   collected earlier today
 *   inactive  the activity is not running upstream
 *   skipped   the channel has no check-in endpoint
 *   failed    the call failed; the row carries the reason
 */

import { formatAmount } from '../runs.js'
import { formatDuration } from '../accounts.js'

const OUTCOME_LABELS = Object.freeze({
  claimed: '已领取',
  already: '今日已领',
  inactive: '未开启',
  skipped: '无签到',
  failed: '失败',
})

/**
 * Minimal element factory. `h('div', {class: 'x', onclick}, 'text', child)`
 * builds an element, applies attributes/properties, and appends children.
 * Attributes use `setAttribute`; `on*` keys become listeners; `checked`,
 * `value`, `hidden` and `disabled` are set as properties so form controls
 * round-trip correctly.
 *
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {...(Node|string|null|undefined|false)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const node = document.createElement(tag)
  if (attrs !== null && typeof attrs === 'object') {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue
      if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value)
      } else if (key === 'checked' || key === 'value' || key === 'hidden' || key === 'disabled') {
        node[key] = value
      } else {
        node.setAttribute(key, String(value))
      }
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    node.appendChild(typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child))
      : child)
  }
  return node
}

/**
 * Build the panel element tree.
 * @param {{client: object, t: (key: string) => string}} deps
 * @returns {{el: HTMLElement, refresh: () => Promise<void>, dispose: () => void}}
 */
export function createPanel({ client, t = key => key }) {
  const state = {
    summary: null,
    accounts: {},
    balances: {},
    busy: '',
    error: '',
    tab: 'checkin',
  }

  const el = document.createElement('div')
  el.className = 'model-admin'

  const tabs = h('div', { class: 'ma-tabs' })
  const body = h('div', { class: 'ma-body' })
  const banner = h('div', { class: 'ma-banner', hidden: true })
  el.appendChild(tabs)
  el.appendChild(banner)
  el.appendChild(body)

  const tabDefs = [
    ['checkin', '签到'],
    ['accounts', '账号'],
    ['credits', '积分'],
    ['backup', '备份'],
  ]
  for (const [id, label] of tabDefs) {
    const button = h('button', {
      class: 'ma-tab',
      type: 'button',
      'data-tab': id,
      onclick: () => {
        state.tab = id
        renderTabs()
        void renderBody()
      },
    }, label)
    tabs.appendChild(button)
  }

  function renderTabs() {
    for (const button of tabs.querySelectorAll('.ma-tab')) {
      const active = button.getAttribute('data-tab') === state.tab
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-selected', String(active))
    }
  }

  function showError(message) {
    state.error = message
    banner.hidden = message === ''
    banner.textContent = message
  }

  async function refresh() {
    state.busy = 'summary'
    try {
      state.summary = await client.summary()
      showError(state.summary?.pack === true ? '' : '渠道包未挂载：账号与签到不可用，插件功能保持加载。')
      await renderBody()
    } catch (error) {
      showError(String(error?.message ?? error))
    } finally {
      state.busy = ''
    }
  }

  async function renderBody() {
    body.replaceChildren()
    switch (state.tab) {
      case 'accounts':
        renderAccounts(body)
        break
      case 'credits':
        renderCredits(body)
        break
      case 'backup':
        renderBackup(body)
        break
      default:
        renderCheckin(body)
        break
    }
  }

  // ── check-in ───────────────────────────────────────────────────────────────

  function renderCheckin(root) {
    const checkin = state.summary?.checkin
    const card = h('section', { class: 'ma-card' })

    const head = h('div', { class: 'ma-card-head' })
    head.appendChild(h('h3', {}, '每日签到'))
    const runButton = h('button', {
      class: 'ma-button ma-button-primary',
      type: 'button',
      disabled: state.busy !== '' || checkin?.ranToday === true,
      onclick: async () => {
        state.busy = 'checkin'
        try {
          const result = await client.runCheckin()
          if (result?.alreadyRanToday === true) showError('今天已经跑过了。')
          else showError('')
          await refresh()
        } catch (error) {
          showError(String(error?.message ?? error))
        } finally {
          state.busy = ''
        }
      },
    }, state.busy === 'checkin' ? '运行中…' : checkin?.ranToday === true ? '今日已跑' : '立即运行')
    head.appendChild(runButton)
    card.appendChild(head)

    const status = h('p', { class: 'ma-status' })
    status.textContent = checkin?.ranToday === true
      ? `今日已运行：${checkin.lastResult || '无记录'}`
      : checkin?.running === true
        ? '正在运行…'
        : '今天还没有运行。'
    card.appendChild(status)

    const auto = h('label', { class: 'ma-switch' })
    const autoBox = h('input', {
      type: 'checkbox',
      checked: state.summary?.settings?.autoCheckin !== false,
      onchange: async event => {
        try {
          await client.updateSettings({ autoCheckin: event.target.checked })
          await refresh()
        } catch (error) {
          showError(String(error?.message ?? error))
        }
      },
    })
    auto.appendChild(autoBox)
    auto.appendChild(h('span', {}, '自动运行'))
    card.appendChild(auto)

    const hourRow = h('label', { class: 'ma-field' })
    hourRow.appendChild(h('span', {}, '运行时间（UTC+8）'))
    const hour = h('input', {
      type: 'number', min: '0', max: '23', value: String(state.summary?.settings?.runHour ?? 9),
      onchange: async event => {
        try {
          await client.updateSettings({ runHour: Number(event.target.value) })
        } catch (error) {
          showError(String(error?.message ?? error))
        }
      },
    })
    hourRow.appendChild(hour)
    card.appendChild(hourRow)

    const rows = checkin?.rows ?? []
    if (rows.length > 0) {
      const table = h('table', { class: 'ma-table' })
      table.appendChild(h('thead', {}, h('tr', {},
        h('th', {}, '渠道'), h('th', {}, '结果'), h('th', {}, '详情'))))
      const tbody = h('tbody', {})
      for (const row of rows) {
        const outcome = OUTCOME_LABELS[row.outcome] ?? row.outcome
        const detail = row.outcome === 'claimed'
          ? [row.credit > 0 ? `${formatAmount(row.credit)} 积分` : '', row.token > 0 ? `${formatAmount(row.token)} Token` : '']
            .filter(Boolean).join(' + ') || '—'
          : row.message ?? '—'
        tbody.appendChild(h('tr', {},
          h('td', {}, channelName(row.channel)),
          h('td', { class: `ma-outcome ma-outcome-${row.outcome}` }, outcome),
          h('td', {}, detail)))
      }
      table.appendChild(tbody)
      card.appendChild(table)
    }

    const channels = state.summary?.channels ?? []
    if (channels.length > 0) {
      card.appendChild(h('p', { class: 'ma-hint' },
        `参与自动签到的渠道：${channels.map(c => c.name).join('、')}。`))
    }
    root.appendChild(card)
  }

  // ── accounts ───────────────────────────────────────────────────────────────

  async function renderAccounts(root) {
    const card = h('section', { class: 'ma-card' })
    card.appendChild(h('h3', {}, '账号'))
    const list = h('div', { class: 'ma-accounts' })
    card.appendChild(list)
    root.appendChild(card)

    const channels = (state.summary?.channels ?? []).map(c => c.id)
    const all = channels.length > 0 ? channels : []
    for (const channel of all) {
      const row = h('div', { class: 'ma-account-row' })
      row.appendChild(h('span', { class: 'ma-account-channel' }, channelName(channel)))
      const status = h('span', { class: 'ma-account-status' }, '读取中…')
      row.appendChild(status)
      list.appendChild(row)
      void client.accounts(channel)
        .then(result => {
          const accounts = result?.accounts ?? []
          status.textContent = accounts.length === 0
            ? '未登录'
            : `${accounts.length} 个账号（${accounts.filter(a => a.disabled !== true).length} 可用）`
        })
        .catch(error => {
          status.textContent = `读取失败：${String(error?.message ?? error)}`
        })
    }
    card.appendChild(h('p', { class: 'ma-hint' },
      '账号的添加、删除、续期与测试在各渠道的登录入口完成；本页汇总全部渠道的账号概况。'))
  }

  // ── credits ────────────────────────────────────────────────────────────────

  async function renderCredits(root) {
    const card = h('section', { class: 'ma-card' })
    card.appendChild(h('h3', {}, '积分'))
    const list = h('div', { class: 'ma-credits' })
    card.appendChild(list)
    root.appendChild(card)

    const channels = (state.summary?.channels ?? []).map(c => c.id)
    for (const channel of channels) {
      const row = h('div', { class: 'ma-credit-row' })
      row.appendChild(h('span', { class: 'ma-credit-channel' }, channelName(channel)))
      const value = h('span', { class: 'ma-credit-value' }, '读取中…')
      row.appendChild(value)
      list.appendChild(row)
      void client.balances(channel)
        .then(result => {
          const packs = result?.balances ?? []
          if (packs.length === 0) {
            value.textContent = '—'
            return
          }
          const credit = packs.filter(p => p.unit !== 'token').reduce((sum, p) => sum + (Number(p.remaining) || 0), 0)
          const token = packs.filter(p => p.unit === 'token').reduce((sum, p) => sum + (Number(p.remaining) || 0), 0)
          const parts = []
          if (credit > 0) parts.push(`${formatAmount(credit)} 积分`)
          if (token > 0) parts.push(`${formatAmount(token)} Token`)
          value.textContent = parts.length > 0 ? parts.join(' · ') : '0'
        })
        .catch(error => {
          value.textContent = `读取失败：${String(error?.message ?? error)}`
        })
    }
    card.appendChild(h('p', { class: 'ma-hint' }, '积分与 Token 是两种单位，不合并求和。'))
  }

  // ── backup ─────────────────────────────────────────────────────────────────

  function renderBackup(root) {
    const card = h('section', { class: 'ma-card' })
    card.appendChild(h('h3', {}, '备份'))
    card.appendChild(h('p', { class: 'ma-hint' },
      '导出包含各渠道登录凭据的归档。文件含敏感信息，请妥善保管。'))
    const button = h('button', {
      class: 'ma-button ma-button-primary',
      type: 'button',
      disabled: state.busy !== '',
      onclick: async () => {
        state.busy = 'backup'
        try {
          const result = await client.exportBackup()
          showError('')
          const name = result?.file ?? result?.path ?? ''
          card.appendChild(h('p', { class: 'ma-status' }, name ? `已导出：${name}` : '已导出。'))
        } catch (error) {
          showError(String(error?.message ?? error))
        } finally {
          state.busy = ''
        }
      },
    }, state.busy === 'backup' ? '导出中…' : '导出凭据归档')
    card.appendChild(button)
    root.appendChild(card)
  }

  function channelName(id) {
    const row = state.summary?.channels?.find(c => c.id === id)
    return row?.name ?? id
  }

  renderTabs()
  void refresh()

  return {
    el,
    refresh,
    dispose() {
      el.replaceChildren()
    },
  }
}

export { OUTCOME_LABELS }
