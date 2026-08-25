/** 飞书开放平台直连：tenant_access_token 缓存 + 纯文本直发/线程回帖。 */

import { createHash } from 'node:crypto'
import { FEISHU_OPEN_BASE } from '../shared/constants.js'

const FETCH_TIMEOUT_MS = 15000
// token 无效类错误码：命中即逐出缓存，避免换 secret 后最长 2h 沿用旧 token
const INVALID_TOKEN_CODES = new Set([99991663, 99991661, 99991668])

export function createFeishuApi() {
  // ── token 缓存（tenant_access_token ~2h）──
  // key 含 secret 摘要：删 bot 后同 appId 重配新 secret 时不会沿用旧 token。
  const tokenCache = new Map()

  const cacheKey = (appId, appSecret) =>
    appId + ':' + createHash('sha256').update(String(appSecret)).digest('hex').slice(0, 12)

  async function tenantToken(appId, appSecret) {
    const key = cacheKey(appId, appSecret)
    const hit = tokenCache.get(key)
    if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token
    const res = await fetch(FEISHU_OPEN_BASE + '/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const body = await res.json().catch(() => ({}))
    if (body.code !== 0 || !body.tenant_access_token) {
      throw new Error('tenant_access_token: ' + JSON.stringify(body))
    }
    const ttlMs = (body.expire ?? 7200) * 1000
    tokenCache.set(key, { token: body.tenant_access_token, expiresAt: Date.now() + ttlMs })
    return body.tenant_access_token
  }

  /** 业务 API 调用包装：token 失效时逐出缓存（下次调用会重新获取）。 */
  async function callFeishu(key, path, init) {
    const res = await fetch(FEISHU_OPEN_BASE + path, {
      ...init,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.code !== 0) {
      if (INVALID_TOKEN_CODES.has(body.code)) tokenCache.delete(key)
      return { ok: false, status: res.status, body }
    }
    return { ok: true, body }
  }

  async function sendTextMessage({ appId, appSecret, receiveId, receiveType }, text) {
    const key = cacheKey(appId, appSecret)
    const token = await tenantToken(appId, appSecret)
    const { ok, status, body } = await callFeishu(key, '/im/v1/messages?receive_id_type=' + receiveType, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({
        receive_id: receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    })
    if (!ok) throw new Error('feishu im/v1/messages ' + status + ': ' + JSON.stringify(body))
    return body?.data?.message_id ?? ''
  }

  /** 线程回帖（REST 版）：供提问桥等不依赖 WSClient 的路径使用。 */
  async function replyToMessage({ appId, appSecret, messageId }, text) {
    const key = cacheKey(appId, appSecret)
    const token = await tenantToken(appId, appSecret)
    const { ok, status, body } = await callFeishu(
      key,
      '/im/v1/messages/' + encodeURIComponent(messageId) + '/reply',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ msg_type: 'text', content: JSON.stringify({ text }) }),
      },
    )
    if (!ok) throw new Error('feishu im/v1/messages/reply ' + status + ': ' + JSON.stringify(body))
    return body?.data?.message_id ?? ''
  }

  return { tenantToken, sendTextMessage, replyToMessage }
}
