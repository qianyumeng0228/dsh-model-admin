/**
 * The console page — shell, tab state and the shared summary read.
 *
 * One `summary` call on mount feeds every tab (pack state, check-in state,
 * route count, settings); each tab then reads its own detail on first
 * paint. A failed summary shows the reason in the banner instead of five
 * empty pages — an empty list must never read as "you have no accounts".
 *
 * Layout follows the host settings panel's geometry: the root is height-
 * bounded (so the tab bar stays fixed) and only the body scrolls.
 */

import { createElement as h, useState, useEffect, useCallback } from 'react'
import {
  CheckinSection, RouteSection, AccountsSection, CreditsSection, BackupSection,
} from './sections.js'

const TABS = [
  ['checkin', '签到'],
  ['route', '路由'],
  ['accounts', '账号'],
  ['credits', '积分'],
  ['backup', '备份'],
]

export function ModelAdminPage({ client, t = key => key }) {
  const [tab, setTab] = useState('checkin')
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const refresh = useCallback(async () => {
    setBusy('summary')
    try {
      const next = await client.summary()
      setSummary(next)
      setError(next?.pack === true ? '' : '渠道包未挂载：账号、签到与路由不可用，插件功能保持加载。')
    } catch (cause) {
      setError(String(cause?.message ?? cause))
    } finally {
      setBusy('')
    }
  }, [client])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const shared = { client, t, summary, busy, setBusy, refresh, setError }

  return h('div', { className: 'dsh-model-admin' },
    error === '' ? null : h('div', { className: 'ma-banner', role: 'alert' }, error),
    h('div', { className: 'ma-tabs', role: 'tablist' },
      TABS.map(([id, label]) => h('button', {
        key: id,
        type: 'button',
        role: 'tab',
        className: `ma-tab${tab === id ? ' is-active' : ''}`,
        'aria-selected': tab === id ? 'true' : 'false',
        onclick: () => setTab(id),
      }, label))),
    h('div', { className: 'ma-body', role: 'tabpanel' },
      h(Section, { tab, ...shared })))
}

/** One tab's section, keyed so switching remounts (fresh per-tab reads). */
function Section({ tab, ...shared }) {
  switch (tab) {
    case 'route':
      return h(RouteSection, { key: 'route', ...shared })
    case 'accounts':
      return h(AccountsSection, { key: 'accounts', ...shared })
    case 'credits':
      return h(CreditsSection, { key: 'credits', ...shared })
    case 'backup':
      return h(BackupSection, { key: 'backup', ...shared })
    default:
      return h(CheckinSection, { key: 'checkin', ...shared })
  }
}
