import test from 'node:test'
import assert from 'node:assert/strict'
import { pickRouteInfo } from '../lib/host/session-gateway.js'
import { formatRouteAcknowledgement } from '../lib/shared/reply-routing.js'

test('pickRouteInfo extracts cwd and projection title', () => {
  const info = pickRouteInfo(
    [{ sessionId: 's1', cwd: '/tmp/proj-w', projections: { values: { title: '测试会话' } } }],
    's1',
    '/fallback',
  )
  assert.deepEqual(info, { workspacePath: '/tmp/proj-w', sessionTitle: '测试会话' })
})

test('pickRouteInfo falls back when the session is absent from the list', () => {
  const info = pickRouteInfo([], 'missing', '/fallback')
  assert.deepEqual(info, { workspacePath: '/fallback', sessionTitle: '未命名会话' })
})

test('pickRouteInfo tolerates a malformed list payload', () => {
  const info = pickRouteInfo(null, 's1', '/fallback')
  assert.deepEqual(info, { workspacePath: '/fallback', sessionTitle: '未命名会话' })
})

test('route acknowledgement degrades gracefully on missing metadata', () => {
  const text = formatRouteAcknowledgement({})
  assert.match(text, /空间：未知空间/)
  assert.match(text, /会话：未命名会话（未知 session）/)
})
