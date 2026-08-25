/**
 * Provisioning 回归测试：直驱 installConnectionRpc 的 handle()，
 * 用注入的 registerAppFn 捕获参数并模拟二维码/失败。
 *
 * 锁定 bug：registerApp 的 domain 必须是裸主机名（SDK 拼 https://${domain}）；
 * 传 WSClient 风格的 'feishu' 会变成 https://feishu → ENOTFOUND →
 * 用户只见 "Provisioning did not produce a QR code. internal"。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { installConnectionRpc, FEISHU_ENDPOINTS } from '../lib/host/connection-rpc.js'

function makeCtx() {
  let handler = null
  const ctx = {
    connection: { rpc: { handle(channel, h) { handler = h; return () => {} } } },
  }
  return { ctx, invoke: (endpoint, payload = {}) => handler(endpoint, payload) }
}

const EMPTY_DEPS = {
  config2Dest: () => ({ chatId: '', openId: '' }),
  runtimes: new Map(), botErrors: new Map(),
  loadFeishuBots: () => [], saveBots: () => {},
  credentials: { resolve: async () => null, unset: async () => {} },
  registerAppFn: null, launchBot: async () => {}, stopBot: () => {},
  resolveBotSecret: async () => null, dshHome: '/tmp/does-not-matter',
  log: () => {},
}

test('provision.begin passes a bare hostname to registerApp and returns the QR', async () => {
  const captured = []
  const { ctx, invoke } = makeCtx()
  const deps = {
    ...EMPTY_DEPS,
    registerAppFn(options) {
      captured.push(options)
      queueMicrotask(() => options.onQRCodeReady({ url: 'https://accounts.feishu.cn/qr?x=1', expireIn: 600 }))
      return new Promise(() => {}) // 轮询永不结束即可
    },
  }
  installConnectionRpc(ctx, deps)

  const res = await invoke(FEISHU_ENDPOINTS.beginProvisioning, {})
  assert.equal(res.ok, true)
  assert.equal(res.value.verificationUrl, 'https://accounts.feishu.cn/qr?x=1')
  // 锁定本 bug 的核心断言：裸主机名，绝不能是 'feishu' 这类枚举字符串
  assert.equal(captured[0].domain, 'accounts.feishu.cn')
})

test('provision.begin surfaces the real registerApp failure instead of generic internal', async () => {
  const { ctx, invoke } = makeCtx()
  const deps = {
    ...EMPTY_DEPS,
    registerAppFn() {
      return Promise.reject(Object.assign(new Error('getaddrinfo ENOTFOUND feishu'), { code: 'ENOTFOUND' }))
    },
  }
  installConnectionRpc(ctx, deps)

  const res = await invoke(FEISHU_ENDPOINTS.beginProvisioning, {})
  assert.equal(res.ok, false)
  assert.match(res.error.message, /Provisioning failed: getaddrinfo ENOTFOUND feishu/)
  assert.notEqual(res.error.code, 'internal')
})
