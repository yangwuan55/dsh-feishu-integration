import test from 'node:test'
import assert from 'node:assert/strict'
import { findReplyMapping, formatRouteAcknowledgement } from '../lib/index.js'

test('continuous thread replies fall back from an unmapped parent to mapped root', () => {
  const map = new Map([
    ['om_summary', { sessionId: 'session-1' }],
  ])
  const mapped = findReplyMapping(
    { parent_id: 'om_bot_answer_1', root_id: 'om_summary' },
    (messageId) => map.get(messageId) ?? null,
  )
  assert.deepEqual(mapped, { sessionId: 'session-1' })
})

test('a mapped parent takes precedence over the root mapping', () => {
  const map = new Map([
    ['om_parent', { sessionId: 'session-parent' }],
    ['om_root', { sessionId: 'session-root' }],
  ])
  const mapped = findReplyMapping(
    { parent_id: 'om_parent', root_id: 'om_root' },
    (messageId) => map.get(messageId) ?? null,
  )
  assert.deepEqual(mapped, { sessionId: 'session-parent' })
})

test('route acknowledgement names the workspace and target session', () => {
  const text = formatRouteAcknowledgement({
    workspacePath: '/Users/ymr/github/agent',
    sessionTitle: '飞书回复自动定位原会话',
    sessionId: 'session-12345678-90ab-cdef-1234-567890abcdef',
  })
  assert.match(text, /已转发到对应 DSH 会话/)
  assert.match(text, /空间：\/Users\/ymr\/github\/agent/)
  assert.match(text, /会话：飞书回复自动定位原会话/)
  assert.match(text, /session-12345678/)
})
