/**
 * The five console sections, as React components.
 *
 * Each section owns its own detail read (accounts / balances / routes);
 * the shared summary arrives through props. Mutations go through the same
 * client, then re-read — a list never shows an order the host is not using.
 *
 * Outcome vocabulary (shared with the host half):
 *   claimed / already / skipped / failed / inactive
 */

import { createElement as h, useState, useEffect, useCallback } from 'react'
import { formatAmount } from '../runs.js'

const OUTCOME_LABELS = {
  claimed: '已领取',
  already: '今日已领',
  inactive: '未开启',
  skipped: '无签到',
  failed: '失败',
}

/** Shared card chrome: title, optional head action, children. */
function Card({ title, action, children }) {
  return h('section', { className: 'ma-card' },
    h('div', { className: 'ma-card-head' }, h('h3', {}, title), action ?? null),
    children)
}

// ── check-in ─────────────────────────────────────────────────────────────────

export function CheckinSection({ client, summary, busy, setBusy, refresh, setError }) {
  const checkin = summary?.checkin
  const ranToday = checkin?.ranToday === true

  const run = useCallback(async () => {
    setBusy('checkin')
    try {
      const result = await client.runCheckin()
      setError(result?.alreadyRanToday === true ? '今天已经跑过了。' : '')
      await refresh()
    } catch (cause) {
      setError(String(cause?.message ?? cause))
    } finally {
      setBusy('')
    }
  }, [client, refresh, setBusy, setError])

  const patchSettings = useCallback(async patch => {
    try {
      await client.updateSettings(patch)
      await refresh()
    } catch (cause) {
      setError(String(cause?.message ?? cause))
    }
  }, [client, refresh, setError])

  return h(Card, {
    title: '每日签到',
    action: h('button', {
      type: 'button',
      className: 'ma-button ma-button-primary',
      disabled: busy !== '' || ranToday,
      onclick: run,
    }, busy === 'checkin' ? '运行中…' : ranToday ? '今日已跑' : '立即运行'),
  },
    h('p', { className: 'ma-status' },
      ranToday
        ? `今日已运行：${checkin?.lastResult || '无记录'}`
        : checkin?.running === true ? '正在运行…' : '今天还没有运行。'),
    h('label', { className: 'ma-switch' },
      h('input', {
        type: 'checkbox',
        checked: summary?.settings?.autoCheckin !== false,
        onchange: event => void patchSettings({ autoCheckin: event.target.checked }),
      }),
      h('span', {}, '自动运行')),
    h('label', { className: 'ma-field' },
      h('span', {}, '运行时间（UTC+8）'),
      h('input', {
        type: 'number',
        min: '0',
        max: '23',
        value: String(summary?.settings?.runHour ?? 9),
        onchange: event => void patchSettings({ runHour: Number(event.target.value) }),
      })),
    h('p', { className: 'ma-hint' },
      '错过（宿主关机）的轮次会在下次启动 30 秒后补跑；一轮只领到"无签到/未开启"不记今日，下次启动重试。'),
    h(ResultTable, { rows: checkin?.rows ?? [] }),
    h('p', { className: 'ma-hint' },
      `参与自动签到的渠道：${(summary?.channels ?? []).map(c => c.name).join('、')}。`))

}

function ResultTable({ rows }) {
  if (rows.length === 0) return null
  return h('table', { className: 'ma-table' },
    h('thead', {}, h('tr', {}, h('th', {}, '渠道'), h('th', {}, '结果'), h('th', {}, '详情'))),
    h('tbody', {}, rows.map((row, index) => {
      const detail = row.outcome === 'claimed'
        ? [row.credit > 0 ? `${formatAmount(row.credit)} 积分` : '', row.token > 0 ? `${formatAmount(row.token)} Token` : '']
          .filter(Boolean).join(' + ') || '—'
        : row.message ?? '—'
      return h('tr', { key: `${row.channel}-${index}` },
        h('td', {}, row.channel),
        h('td', { className: `ma-outcome ma-outcome-${row.outcome}` }, OUTCOME_LABELS[row.outcome] ?? row.outcome),
        h('td', {}, detail))
    })))
}

// ── route ────────────────────────────────────────────────────────────────────

export function RouteSection({ client, summary, setError }) {
  const [data, setData] = useState(null)
  const [readError, setReadError] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await client.call('routes'))
      setReadError('')
    } catch (cause) {
      setReadError(String(cause?.message ?? cause))
    }
  }, [client])

  useEffect(() => { void load() }, [load])

  const mutate = useCallback(async (method, payload) => {
    try {
      await client.call(method, payload)
      await load()
    } catch (cause) {
      setError(String(cause?.message ?? cause))
    }
  }, [client, load, setError])

  const entries = data?.entries ?? []
  const dispatch = data?.dispatch ?? []

  return h('div', { className: 'ma-routes' },
    h(Card, { title: '模型路由' },
      h('p', { className: 'ma-hint' },
        '同一个模型在多个渠道可用时，路由把它归成一个条目：按候选顺序发请求，某个渠道在产出任何内容前失败，'
        + '自动换下一个。点候选上的 ☆ 置顶该渠道，★ 的顺序就是优先顺序。'),
      summary?.route !== true
        ? h('p', { className: 'ma-status' }, '路由未启用（本组合没有 llm 服务）。')
        : readError !== ''
          ? h('p', { className: 'ma-status' }, `读取失败：${readError}`)
          : entries.length === 0
            ? h('p', { className: 'ma-status' },
                '暂无路由条目——登录至少一个渠道后，它们目录里的模型会自动出现在这里。')
            : entries.map(entry => h(RouteRow, {
                key: entry.key,
                entry,
                dispatch,
                mutate,
              }))))
}

function RouteRow({ entry, dispatch, mutate }) {
  const pinned = entry.pinned ?? []
  const togglePin = channel => {
    const current = [...pinned]
    const at = current.indexOf(channel)
    if (at >= 0) current.splice(at, 1)
    else {
      // A newly pinned channel joins the FRONT — the click means "use this
      // first", not "add it to the end of the list".
      current.unshift(channel)
    }
    void mutate('routeSetPinned', { key: entry.key, pinned: current })
  }

  return h('div', { className: 'ma-route-row' },
    h('div', { className: 'ma-route-head' },
      h('span', { className: 'ma-route-name' }, entry.name),
      h('span', { className: 'ma-route-count' }, `${entry.candidates.length} 渠道`),
      h('select', {
        className: 'ma-select',
        value: entry.strategy,
        onchange: event => void mutate('routeSetStrategy', { key: entry.key, strategy: event.target.value }),
      },
        h('option', { value: 'fallback' }, '顺序'),
        h('option', { value: 'round-robin' }, '轮换'),
        h('option', { value: 'sticky' }, '会话粘连'))),
    h('p', { className: 'ma-hint' }, capacityText(entry)),
    h('div', { className: 'ma-route-candidates' },
      entry.candidates.map((candidate, index) => {
        const isPinned = pinned.includes(candidate.channel)
        const turns = dispatch.find(d => d.model === entry.key && d.channel === candidate.channel)?.turns
        return h('button', {
          key: candidate.channel,
          type: 'button',
          className: `ma-chip${isPinned ? ' is-pinned' : ''}`,
          title: isPinned ? `取消优先：${candidate.channel}` : `优先使用：${candidate.channel}`,
          onclick: () => togglePin(candidate.channel),
        },
          h('span', { className: 'ma-chip-order' }, String(index + 1)),
          candidate.channel,
          isPinned ? ' ★' : ' ☆',
          Number.isFinite(turns) && turns > 0
            ? h('span', { className: 'ma-chip-turns' }, `${turns} 次`)
            : null)
      })))
}

function capacityText(entry) {
  const caps = []
  if (Number.isFinite(entry.contextWindow)) caps.push(`上下文 ${formatAmount(entry.contextWindow)}`)
  if (Number.isFinite(entry.maxTokens)) caps.push(`输出 ${formatAmount(entry.maxTokens)}`)
  caps.push(`模态 ${(entry.inputModalities ?? ['text']).join('/')}`)
  return `容量取候选交集：${caps.join(' · ')}`
}

// ── accounts ─────────────────────────────────────────────────────────────────

export function AccountsSection({ client, summary }) {
  const channels = (summary?.channels ?? []).map(c => c.id)
  return h(Card, { title: '账号' },
    h('div', { className: 'ma-accounts' },
      channels.length === 0
        ? h('p', { className: 'ma-status' }, '没有可管理的渠道。')
        : channels.map(channel => h(AccountRow, { key: channel, client, channel }))),
    h('p', { className: 'ma-hint' },
      '账号的添加、删除、续期与测试在各渠道的登录入口完成；本页汇总全部渠道的账号概况。'))
}

function AccountRow({ client, channel }) {
  const [text, setText] = useState('读取中…')
  useEffect(() => {
    let alive = true
    void client.accounts(channel)
      .then(result => {
        if (!alive) return
        const accounts = result?.accounts ?? []
        setText(accounts.length === 0
          ? '未登录'
          : `${accounts.length} 个账号（${accounts.filter(a => a.disabled !== true).length} 可用）`)
      })
      .catch(cause => {
        if (alive) setText(`读取失败：${String(cause?.message ?? cause)}`)
      })
    return () => { alive = false }
  }, [client, channel])
  return h('div', { className: 'ma-account-row' },
    h('span', { className: 'ma-account-channel' }, channel),
    h('span', { className: 'ma-account-status' }, text))
}

// ── credits ──────────────────────────────────────────────────────────────────

export function CreditsSection({ client, summary }) {
  const channels = (summary?.channels ?? []).map(c => c.id)
  return h(Card, { title: '积分' },
    h('div', { className: 'ma-credits' },
      channels.length === 0
        ? h('p', { className: 'ma-status' }, '没有可管理的渠道。')
        : channels.map(channel => h(CreditRow, { key: channel, client, channel }))),
    h('p', { className: 'ma-hint' }, '积分与 Token 是两种单位，不合并求和。'))
}

function CreditRow({ client, channel }) {
  const [text, setText] = useState('读取中…')
  useEffect(() => {
    let alive = true
    void client.balances(channel)
      .then(result => {
        if (!alive) return
        const packs = result?.balances ?? []
        if (packs.length === 0) {
          setText('—')
          return
        }
        const credit = packs.filter(p => p.unit !== 'token').reduce((sum, p) => sum + (Number(p.remaining) || 0), 0)
        const token = packs.filter(p => p.unit === 'token').reduce((sum, p) => sum + (Number(p.remaining) || 0), 0)
        const parts = []
        if (credit > 0) parts.push(`${formatAmount(credit)} 积分`)
        if (token > 0) parts.push(`${formatAmount(token)} Token`)
        setText(parts.length > 0 ? parts.join(' · ') : '0')
      })
      .catch(cause => {
        if (alive) setText(`读取失败：${String(cause?.message ?? cause)}`)
      })
    return () => { alive = false }
  }, [client, channel])
  return h('div', { className: 'ma-credit-row' },
    h('span', { className: 'ma-credit-channel' }, channel),
    h('span', { className: 'ma-credit-value' }, text))
}

// ── backup ───────────────────────────────────────────────────────────────────

export function BackupSection({ client, busy, setBusy, setError }) {
  const [note, setNote] = useState('')
  const run = useCallback(async () => {
    setBusy('backup')
    try {
      const result = await client.exportBackup()
      setError('')
      const name = result?.file ?? result?.path ?? ''
      setNote(name ? `已导出：${name}` : '已导出。')
    } catch (cause) {
      setError(String(cause?.message ?? cause))
    } finally {
      setBusy('')
    }
  }, [client, setBusy, setError])

  return h(Card, { title: '备份' },
    h('p', { className: 'ma-hint' }, '导出包含各渠道登录凭据的归档。文件含敏感信息，请妥善保管。'),
    h('button', {
      type: 'button',
      className: 'ma-button ma-button-primary',
      disabled: busy !== '',
      onclick: run,
    }, busy === 'backup' ? '导出中…' : '导出凭据归档'),
    note === '' ? null : h('p', { className: 'ma-status' }, note))
}
