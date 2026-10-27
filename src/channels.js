/**
 * Channel capability table — the plugin's domain model.
 *
 * One row per account channel the console can manage. `checkin` names the
 * daily-reward mechanism the channel actually offers; the console only
 * promises what the row says, so a channel without a check-in endpoint is
 * never offered a "sign in" button that cannot succeed.
 *
 * Source of truth for the capabilities: the vendored channel pack's provider
 * registry plus the upstream capability matrix (see NOTICE.md). Keep rows in
 * sync with `vendor/channel-pack/src/providers` when the pack is refreshed.
 */

/** How a channel's login flow is driven. */
export const LOGIN_KINDS = Object.freeze({
  /** Browser opens an authorization page; the pack polls for the token. */
  BROWSER: 'browser',
  /** Device-code flow with polling (OAuth device authorization). */
  DEVICE_CODE: 'device-code',
  /** SMS code: request a code, then submit it. */
  SMS: 'sms',
  /** QR / WeChat scan handled by the upstream page. */
  SCAN: 'scan',
})

/**
 * The daily-reward mechanism, or `none` when the channel has no callable
 * check-in. `auto` means the server grants the reward on login or by an
 * automatic claim with no manual entry — the console still runs it daily,
 * but the row explains there is no manual button upstream.
 */
export const CHECKIN_KINDS = Object.freeze({
  /** POST a claim once per UTC+8 day. */
  DAILY: 'daily',
  /** Granted automatically; the console probes and reports only. */
  AUTO: 'auto',
  /** No check-in endpoint exists. */
  NONE: 'none',
})

/**
 * @typedef {object} ChannelRow
 * @property {string} id Stable channel id used by the pack's RPC.
 * @property {string} name Display name (Chinese, matching upstream).
 * @property {string} vendor Owning company, for grouping.
 * @property {keyof typeof LOGIN_KINDS} login How sign-in is driven.
 * @property {keyof typeof CHECKIN_KINDS} checkin Daily-reward mechanism.
 * @property {boolean} balance Whether a credit balance can be read.
 * @property {boolean} multiAccount Whether several accounts may coexist.
 * @property {string} note One-line caveat shown in the UI, or ''.
 */

/** @type {readonly ChannelRow[]} */
export const CHANNELS = Object.freeze([
  Object.freeze({
    id: 'buddy', name: 'CodeBuddy（腾讯）', vendor: '腾讯', login: 'browser', checkin: 'none', balance: true, multiAccount: true,
    note: '成长任务与连登奖励需 WorkBuddy 客户端；本渠道包无签到接口',
  }),
  Object.freeze({
    id: 'workbuddy', name: 'WorkBuddy（国际版）', vendor: '腾讯', login: 'browser', checkin: 'none', balance: true, multiAccount: true,
    note: '无签到接口；登录即发每日额度（24h 有效、不累积）',
  }),
  Object.freeze({
    id: 'codearts', name: 'CodeArts（华为云）', vendor: '华为', login: 'browser', checkin: 'none', balance: true, multiAccount: true, note: '本渠道包无签到接口',
  }),
  Object.freeze({
    id: 'lobsterai', name: 'LobsterAI（有道）', vendor: '网易', login: 'browser', checkin: 'none', balance: true, multiAccount: true, note: '本渠道包无签到接口',
  }),
  Object.freeze({
    id: 'qoder', name: 'Qoder（阿里系）', vendor: '阿里', login: 'device-code', checkin: 'none', balance: true, multiAccount: true, note: '本渠道包无签到接口',
  }),
  Object.freeze({
    id: 'qodercn', name: 'Qoder 中国版', vendor: '阿里', login: 'device-code', checkin: 'none', balance: true, multiAccount: true, note: '本渠道包无签到接口',
  }),
  Object.freeze({
    id: 'trae', name: 'TRAE（字节跳动）', vendor: '字节', login: 'browser', checkin: 'none', balance: true, multiAccount: true, note: '本渠道包无签到接口',
  }),
  Object.freeze({
    id: 'cline', name: 'Cline', vendor: 'Cline', login: 'device-code', checkin: 'none', balance: true, multiAccount: true, note: 'WorkOS 设备码',
  }),
  Object.freeze({
    id: 'loomy', name: 'Loomy（讯飞）', vendor: '讯飞', login: 'sms', checkin: 'daily', balance: true, multiAccount: true,
    note: '短信登录；每日额度签到；凭据不能自动续期',
  }),
  Object.freeze({
    id: 'raccoon', name: 'Raccoon Work（商汤）', vendor: '商汤', login: 'scan', checkin: 'auto', balance: true, multiAccount: true,
    note: '微信扫码 / 短信；一次性登录奖励（每号一次）',
  }),
  Object.freeze({
    id: 'minimax', name: 'MiniMax Code（中国版）', vendor: 'MiniMax', login: 'device-code', checkin: 'none', balance: true, multiAccount: true, note: '本渠道包无签到接口',
  }),
  Object.freeze({
    id: 'minimaxintl', name: 'MiniMax Code（国际版）', vendor: 'MiniMax', login: 'device-code', checkin: 'none', balance: true, multiAccount: true,
    note: '本渠道包无签到接口',
  }),
  Object.freeze({
    id: 'zcode', name: 'ZCode（智谱 z.ai）', vendor: '智谱', login: 'device-code', checkin: 'daily', balance: true, multiAccount: true,
    note: '领取含营销活动投放；额度单位为 token',
  }),
  Object.freeze({
    id: 'opencode', name: 'OpenCode', vendor: 'OpenCode', login: 'browser', checkin: 'none', balance: true, multiAccount: true, note: '',
  }),
  Object.freeze({
    id: 'gemini', name: 'Gemini Code Assist', vendor: 'Google', login: 'browser', checkin: 'none', balance: true, multiAccount: true,
    note: '需代理出口；浏览器能用不代表插件能用',
  }),
])

const BY_ID = new Map(CHANNELS.map(row => [row.id, row]))

/** Channel row by id, or undefined. */
export function channelOf(id) {
  return BY_ID.get(String(id ?? ''))
}

/** Every channel id, in display order. */
export function channelIds() {
  return CHANNELS.map(row => row.id)
}

/**
 * Channels whose daily reward the console may run automatically. `none` rows
 * are excluded so the scheduler never calls an endpoint that cannot answer.
 */
export function autoCheckinChannelIds() {
  return CHANNELS.filter(row => row.checkin !== 'none').map(row => row.id)
}

/**
 * Whether a channel needs a human at a browser: manual entry (SMS / scan) or
 * an interactive consent page the console cannot complete on its own.
 */
export function loginNeedsHuman(row) {
  return row.login === 'sms' || row.login === 'scan'
}
