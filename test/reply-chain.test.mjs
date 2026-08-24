import test from 'node:test'
import assert from 'node:assert/strict'
import { findReplyMapping } from '../lib/index.js'

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
