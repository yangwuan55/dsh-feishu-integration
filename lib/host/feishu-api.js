/** 飞书开放平台直连：tenant_access_token 缓存 + 纯文本直发。 */

import { FEISHU_OPEN_BASE } from '../shared/constants.js'

export function createFeishuApi() {
  // ── token 缓存（tenant_access_token ~2h） ──
  const tokenCache = new Map()

  async function tenantToken(appId, appSecret) {
    const hit = tokenCache.get(appId)
    if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token
    const res = await fetch(FEISHU_OPEN_BASE + '/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    })
    const body = await res.json().catch(() => ({}))
    if (body.code !== 0 || !body.tenant_access_token) {
      throw new Error('tenant_access_token: ' + JSON.stringify(body))
    }
    const ttlMs = (body.expire ?? 7200) * 1000
    tokenCache.set(appId, { token: body.tenant_access_token, expiresAt: Date.now() + ttlMs })
    return body.tenant_access_token
  }

  async function sendTextMessage({ appId, appSecret, receiveId, receiveType }, text) {
    const token = await tenantToken(appId, appSecret)
    const res = await fetch(
      FEISHU_OPEN_BASE + '/im/v1/messages?receive_id_type=' + receiveType,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        }),
      },
    )
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.code !== 0) {
      throw new Error('feishu im/v1/messages ' + res.status + ': ' + JSON.stringify(body))
    }
    return body?.data?.message_id ?? ''
  }

  return { tenantToken, sendTextMessage }
}
