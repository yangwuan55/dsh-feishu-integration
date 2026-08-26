/**
 * /api/respond 线路契约锁：服务端 clientResponseSchema 要求完整信封
 * {type:'client-response', rpcId, result}——缺 type 会被 200+bad-response
 * 拒收（曾导致所有飞书作答静默失败）。此测试防止回归。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createMuxClient } from '../lib/host/mux-client.js'

test('respond POSTs the full client-response envelope required by server schema', async () => {
  const captured = []
  const realFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), body: JSON.parse(init.body) })
    return {
      ok: true,
      json: async () => ({ accepted: true }),
    }
  }
  try {
    const mux = createMuxClient({
      origin: 'http://127.0.0.1:1',
      log: () => {},
      openSocket: (_url, handlers) => {
        queueMicrotask(() => handlers.onOpen())
        return { close() { handlers.onClose?.() } }
      },
    })
    const out = await mux.respond({ rpcId: 'rq_x', result: { ok: true, value: {} } })
    assert.deepEqual(out.receipt, { accepted: true })
    assert.equal(out.retried, false)

    assert.equal(captured.length, 1)
    assert.ok(captured[0].url.endsWith('/api/respond'))
    const body = captured[0].body
    assert.equal(body.type, 'client-response', '信封必须带 type 字段')
    assert.equal(body.rpcId, 'rq_x')
    assert.equal(body.result.ok, true)
    mux.close()
  } finally {
    globalThis.fetch = realFetch
  }
})
