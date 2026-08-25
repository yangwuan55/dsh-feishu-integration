/** feishu-api 回归：token 缓存按 appId+secret 摘要隔离，失败不残留脏缓存。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createFeishuApi } from '../lib/host/feishu-api.js'

function withFakeFetch(handler) {
  const real = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null })
    return handler(calls.length - 1, { url: String(url), body: init?.body ? JSON.parse(init.body) : null })
  }
  return { calls, restore() { globalThis.fetch = real } }
}

test('same appId with a different secret mints a fresh token (no stale reuse)', async () => {
  const api = createFeishuApi()
  let n = 0
  const fake = withFakeFetch(() => {
    n += 1
    return new Response(JSON.stringify({ code: 0, tenant_access_token: 'tk-' + n, expire: 7200 }), { headers: { 'content-type': 'application/json' } })
  })
  try {
    const t1 = await api.tenantToken('cli_a', 'secret-one')
    const t1again = await api.tenantToken('cli_a', 'secret-one')
    assert.equal(t1, 'tk-1')
    assert.equal(t1again, 'tk-1', '同 appId+secret 命中缓存')
    assert.equal(n, 1)

    const t2 = await api.tenantToken('cli_a', 'secret-two')
    assert.equal(t2, 'tk-2', '换 secret 必须重新取 token')
    assert.equal(n, 2)
  } finally {
    fake.restore()
  }
})

test('invalid-token business codes are surfaced (and would evict cache)', async () => {
  const api = createFeishuApi()
  // 先填充缓存
  const seed = withFakeFetch(() => new Response(JSON.stringify({ code: 0, tenant_access_token: 'tk-old', expire: 7200 })))
  await api.tenantToken('cli_b', 's')
  seed.restore()

  const fail = withFakeFetch((i) => {
    if (i === 0) return new Response(JSON.stringify({ code: 99991663, msg: 'invalid token' }))
    return new Response(JSON.stringify({ code: 0, tenant_access_token: 'tk-fresh', expire: 7200 }))
  })
  try {
    await assert.rejects(
      () => api.tenantToken('cli_b', 'other-secret'),
      /99991663/,
    )
    const again = await api.tenantToken('cli_b', 'other-secret')
    assert.equal(again, 'tk-fresh', '失败后再次调用应重新获取而非复用脏缓存')
  } finally {
    fail.restore()
  }
})
