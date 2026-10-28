import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHANNELS, channelOf, channelIds, autoCheckinChannelIds, loginNeedsHuman,
  CHECKIN_KINDS, LOGIN_KINDS,
} from '../src/channels.js'

test('every channel row carries a well-formed capability record', () => {
  const loginValues = new Set(Object.values(LOGIN_KINDS))
  const checkinValues = new Set(Object.values(CHECKIN_KINDS))
  for (const row of CHANNELS) {
    assert.ok(row.id && typeof row.id === 'string', 'id')
    assert.ok(row.name && typeof row.name === 'string', 'name')
    assert.ok(loginValues.has(row.login), `login kind ${row.login}`)
    assert.ok(checkinValues.has(row.checkin), `checkin kind ${row.checkin}`)
    assert.equal(typeof row.balance, 'boolean', 'balance')
    assert.equal(typeof row.multiAccount, 'boolean', 'multiAccount')
  }
})

test('channel ids are unique', () => {
  const ids = channelIds()
  assert.equal(new Set(ids).size, ids.length)
})

test('channelOf resolves by id and tolerates junk', () => {
  assert.equal(channelOf('buddy').name, 'CodeBuddy（腾讯）')
  assert.equal(channelOf('nope'), undefined)
  assert.equal(channelOf(undefined), undefined)
})

test('autoCheckinChannelIds excludes channels with no check-in endpoint', () => {
  const ids = autoCheckinChannelIds()
  assert.ok(!ids.includes('buddy'))
  assert.ok(ids.includes('zcode'))
  assert.ok(!ids.includes('gemini'))
  assert.ok(!ids.includes('workbuddy'))
  assert.ok(!ids.includes('cline'))
})

test('loginNeedsHuman flags SMS and scan flows', () => {
  assert.equal(loginNeedsHuman(channelOf('loomy')), true)
  assert.equal(loginNeedsHuman(channelOf('raccoon')), true)
  assert.equal(loginNeedsHuman(channelOf('buddy')), false)
  assert.equal(loginNeedsHuman(channelOf('qoder')), false)
})

test('the WorkBuddy rows state their caveats', () => {
  assert.equal(channelOf('workbuddy').checkin, 'none')
  assert.match(channelOf('workbuddy').note, /无签到/)
  assert.equal(channelOf('buddy').checkin, 'none')
})

test('zcode is the token-unit channel and says so', () => {
  assert.equal(channelOf('zcode').note.includes('token'), true)
})
