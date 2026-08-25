/**
 * DSH 设置页 Connection RPC（兼容 @xmanrui/dsh-feishu 客户端契约）：
 * /feishu 通道上的 status、QR provisioning、reconnect/disconnect/delete。
 */

import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import * as Lark from '@larksuiteoapi/node-sdk'
import QRCode from 'qrcode'
import { sleep } from '../shared/text.js'

const FEISHU_RPC_CHANNEL = '/feishu'
export const FEISHU_ENDPOINTS = Object.freeze({
  status: 'connection.status',
  beginProvisioning: 'provision.begin',
  pollProvisioning: 'provision.poll',
  cancelProvisioning: 'provision.cancel',
  reconnectBot: 'bot.reconnect',
  disconnectBot: 'bot.disconnect',
  deleteBot: 'bot.delete',
  testConnection: 'connection.test',
  disconnect: 'connection.disconnect',
})
const REQUIRED_TENANT_SCOPES = Object.freeze([
  'im:message.p2p_msg:readonly',
  'im:message.group_at_msg:readonly',
  'im:message:send_as_bot',
  'im:message.reactions:write_only',
  'im:message:recall',
  'cardkit:card:write',
])
const POLL_STATUS_BY_REGISTRATION = Object.freeze({
  idle: 'pending', starting: 'pending', qr_ready: 'pending', polling: 'pending',
  slow_down: 'pending', domain_switched: 'pending', saving: 'connecting',
  succeeded: 'connected', expired: 'expired', cancelled: 'failed', error: 'failed',
})

export function installConnectionRpc(ctx, deps) {
  const registerRpc = ctx?.connection?.rpc?.handle
  if (typeof registerRpc !== 'function') {
    deps.log?.('warn', 'ctx.connection.rpc 不可用，设置页绑定 UI 未注册')
    return null
  }

  const attempts = new Map()
  let nextAttempt = 0
  let revision = 0
  let latestAttemptId = null
  const qrCache = new Map()

  const badRequest = (message) => ({ ok: false, error: { code: 'bad-request', message, details: {} } })
  const cancelled = () => ({ ok: false, error: { code: 'cancelled', message: 'The Feishu request was cancelled.', details: {} } })
  const internalFailure = (message = 'The Feishu integration operation failed.') => ({
    ok: false, error: { code: 'internal', message, details: {} },
  })

  function publicRegistration(rec) {
    if (!rec) return { state: 'idle', attempt: 0 }
    const out = { state: rec.state ?? 'error', attempt: rec.id, updatedAt: rec.updatedAt ?? Date.now() }
    for (const key of ['qrCodeUrl', 'expiresAt', 'remainingSeconds', 'pollIntervalSeconds', 'botId']) {
      if (rec[key] !== undefined && rec[key] !== null) out[key] = rec[key]
    }
    if (rec.error) out.error = { code: rec.error.code ?? 'registration_failed', message: rec.error.message ?? 'Unable to register the Feishu app.' }
    return out
  }

  function connectedFor(bot) {
    return deps.runtimes.get(bot.id)?.ready === true
  }

  function publicBot(bot) {
    const appId = String(bot.appId ?? '')
    return {
      name: bot.botName || '飞书机器人',
      appIdMasked: appId.length > 10 ? appId.slice(0, 7) + '…' + appId.slice(-4) : appId,
      domain: bot.domain === 'lark' ? 'lark' : 'feishu',
      ...(bot.activated !== undefined ? { activated: bot.activated } : {}),
    }
  }

  function publicHealth(connected, configured) {
    return connected
      ? { status: 'healthy', summary: '长连接运行正常', lastCheckedAt: Date.now() }
      : { status: 'offline', summary: configured ? '机器人尚未连接' : '尚未接入飞书机器人', lastCheckedAt: Date.now() }
  }

  function publicBotEntry(bot) {
    const runtime = deps.runtimes.get(bot.id)
    const connected = runtime?.ready === true
    const error = deps.botErrors.get(bot.id)
    return {
      botId: bot.id,
      state: connected ? 'connected' : error ? 'error' : 'disconnected',
      connected,
      configured: true,
      bot: publicBot(bot),
      health: publicHealth(connected, true),
      ...(error ? { error: { code: error.code ?? 'connection_failed', message: error.message ?? String(error) } } : {}),
    }
  }

  async function encodeQr(url) {
    let promise = qrCache.get(url)
    if (!promise) {
      if (qrCache.size >= 32) qrCache.delete(qrCache.keys().next().value)
      promise = QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 320, type: 'image/png' })
      qrCache.set(url, promise)
    }
    return promise
  }

  async function publicProvisioning(rec) {
    if (!rec?.qrCodeUrl) return undefined
    return {
      attemptId: String(rec.id),
      verificationUrl: rec.qrCodeUrl,
      qrCodeDataUrl: await encodeQr(rec.qrCodeUrl),
      expiresAt: rec.expiresAt ?? Date.now() + 300000,
      pollIntervalMs: Math.max(800, Math.min(10000, (rec.pollIntervalSeconds ?? 1.8) * 1000)),
    }
  }

  async function publicStatus(registration = null) {
    const bots = deps.loadFeishuBots()
    const entries = bots.map(publicBotEntry)
    const connected = entries.some((b) => b.connected)
    const activeReg = registration ?? (latestAttemptId !== null ? attempts.get(String(latestAttemptId)) : null)
    const reg = publicRegistration(activeReg)
    const snapshot = {
      schemaVersion: 2,
      revision: ++revision,
      state: connected ? 'connected' : ['starting', 'qr_ready', 'polling', 'slow_down', 'domain_switched', 'saving'].includes(reg.state) ? 'provisioning' : entries.some((b) => b.error) ? 'error' : 'disconnected',
      connected,
      configured: bots.length > 0,
      bot: bots[0] ? publicBot(bots[0]) : undefined,
      health: publicHealth(connected, bots.length > 0),
      bots: entries,
      totals: { configured: entries.length, connected: entries.filter((b) => b.connected).length },
    }
    const provisioning = await publicProvisioning(activeReg)
    if (provisioning) snapshot.provisioning = provisioning
    if (activeReg?.error) snapshot.error = { code: activeReg.error.code ?? 'registration_failed', message: activeReg.error.message ?? 'Unable to register the Feishu app.' }
    return snapshot
  }

  function pollStatus(rec) {
    const connected = rec?.botId && deps.runtimes.get(rec.botId)?.ready === true
    if (rec?.state === 'succeeded') return connected ? 'connected' : 'connecting'
    return POLL_STATUS_BY_REGISTRATION[rec?.state] ?? 'failed'
  }

  function secretRefFor(botId) {
    return 'DSH_FEISHU_APP_SECRET_' + botId.slice(4).toUpperCase()
  }

  async function verifyProvisionedApp(appId, appSecret, domain) {
    const base = domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
    const tokenRes = await fetch(base + '/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    })
    const tokenBody = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok || tokenBody.code !== 0 || !tokenBody.tenant_access_token) throw new Error(tokenBody.msg ?? '飞书认证失败')
    const botRes = await fetch(base + '/open-apis/bot/v3/info/', { headers: { authorization: 'Bearer ' + tokenBody.tenant_access_token } })
    const botBody = await botRes.json().catch(() => ({}))
    if (!botRes.ok || botBody.code !== 0) throw new Error(botBody.msg ?? '读取机器人信息失败')
    const bot = botBody.bot ?? {}
    return { name: bot.app_name ?? bot.bot_name ?? null, openId: bot.open_id ?? null, activated: bot.activate_status ?? null }
  }

  async function acceptCredentials(rec, result) {
    if (rec.cancelled) throw Object.assign(new Error('Registration was cancelled'), { code: 'abort' })
    const appId = result?.client_id
    const appSecret = result?.client_secret
    const userInfo = result?.user_info ?? {}
    const ownerOpenId = userInfo.open_id
    const domain = userInfo.tenant_brand === 'lark' ? 'lark' : 'feishu'
    if (!appId || !appSecret || !ownerOpenId) throw Object.assign(new Error('Feishu registration returned invalid credentials.'), { code: 'invalid_credentials' })
    const identity = await verifyProvisionedApp(appId, appSecret, domain)
    if (rec.cancelled) throw Object.assign(new Error('Registration was cancelled'), { code: 'abort' })
    const bots = deps.loadFeishuBots()
    const existing = bots.find((b) => b.appId === appId)
    const botId = existing?.id ?? 'bot_' + randomUUID().replaceAll('-', '').toLowerCase()
    const secretRef = existing?.secretRef ?? secretRefFor(botId)
    await deps.credentials.set(secretRef, appSecret)
    const now = new Date().toISOString()
    const entry = {
      ...existing, id: botId, appId, secretRef,
      ownerOpenIds: [...new Set([...(existing?.ownerOpenIds ?? []), ownerOpenId])],
      domain, botName: identity.name, botOpenId: identity.openId,
      activated: identity.activated, deletionPending: false,
      connectedAt: now, createdAt: existing?.createdAt ?? now,
    }
    const nextBots = existing ? bots.map((b) => b.id === existing.id ? entry : b) : [...bots, entry]
    deps.saveBots(nextBots)
    rec.botId = botId
    try {
      await deps.launchBot(entry, appSecret)
      deps.botErrors.delete(botId)
    } catch (err) {
      deps.botErrors.set(botId, { code: 'connection_failed', message: '机器人已保存，但暂时无法连接飞书。' })
      deps.log?.('warn', '新 bot 长连接启动失败:', String(err))
    }
  }

  function startProvisioning() {
    const id = String(++nextAttempt)
    const rec = { id, state: 'starting', updatedAt: Date.now(), controller: new AbortController(), cancelled: false }
    attempts.set(id, rec)
    latestAttemptId = id
    const registerApp = deps.registerAppFn ?? Lark.registerApp
    void Promise.resolve().then(() => registerApp({
      // 注意：registerApp 的 domain 是裸主机名（拼进 https://${domain}），
      // 与 WSClient 的枚举字符串 'feishu'/'lark' 是两套约定，不能混用。
      domain: 'accounts.feishu.cn', source: 'deepseek-harness', createOnly: true,
      appPreset: { name: '{user} 的北汇星河 AI 助手', desc: '连接飞书与 DeepSeek Harness，在聊天中使用企业 AI 助手。' },
      addons: { preset: false, scopes: { tenant: [...REQUIRED_TENANT_SCOPES] }, events: { items: { tenant: ['im.message.receive_v1'] } } },
      signal: rec.controller.signal,
      onQRCodeReady: (info) => {
        rec.qrCodeUrl = info.url
        rec.expiresAt = Date.now() + Number(info.expireIn ?? 600) * 1000
        rec.state = 'qr_ready'; rec.updatedAt = Date.now()
      },
      onStatusChange: (info) => {
        if (['polling', 'slow_down', 'domain_switched'].includes(info?.status)) {
          rec.state = info.status
          if (Number.isFinite(Number(info.interval))) rec.pollIntervalSeconds = Number(info.interval)
          rec.updatedAt = Date.now()
        }
      },
    })).then(async (result) => {
      if (rec.cancelled) return
      rec.state = 'saving'; rec.updatedAt = Date.now()
      await acceptCredentials(rec, result)
      rec.state = 'succeeded'; rec.updatedAt = Date.now()
    }).catch((err) => {
      if (rec.cancelled || err?.code === 'abort' || err?.name === 'AbortError') rec.state = 'cancelled'
      else if (err?.code === 'expired_token') rec.state = 'expired'
      else { rec.state = 'error'; rec.error = { code: err?.code ?? 'registration_failed', message: err?.message ?? 'Unable to register the Feishu app.' } }
      rec.updatedAt = Date.now()
    })
    return rec
  }

  function getAttempt(attemptId) { return attempts.get(String(attemptId)) ?? null }

  function cancelProvisioning(attemptId) {
    const rec = getAttempt(attemptId)
    if (!rec) return null
    if (!['starting', 'qr_ready', 'polling', 'slow_down', 'domain_switched', 'saving'].includes(rec.state)) return rec
    rec.cancelled = true; rec.controller.abort(); rec.state = 'cancelled'; rec.updatedAt = Date.now()
    return rec
  }

  async function deleteBot(botId) {
    const bots = deps.loadFeishuBots()
    const bot = bots.find((b) => b.id === botId)
    if (!bot) throw new Error('Unknown Feishu bot')
    deps.stopBot(botId)
    await deps.credentials.unset(bot.secretRef)
    deps.saveBots(bots.filter((b) => b.id !== botId))
    try { rmSync(join(deps.dshHome, 'integrations', 'dsh-feishu', 'bots', botId), { recursive: true, force: true }) } catch { /* best effort */ }
  }

  async function handle(endpoint, payload = {}, signal) {
    if (signal?.aborted) return cancelled()
    const allowed = new Set(Object.values(FEISHU_ENDPOINTS))
    if (!allowed.has(endpoint)) return badRequest('Unknown Feishu endpoint.')
    if (endpoint === FEISHU_ENDPOINTS.status || endpoint === FEISHU_ENDPOINTS.testConnection) {
      if (Object.keys(payload).length) return badRequest('This endpoint accepts an empty payload only.')
      return { ok: true, value: await publicStatus() }
    }
    try {
      if (endpoint === FEISHU_ENDPOINTS.beginProvisioning) {
        if (payload.locale !== undefined && payload.locale !== 'zh-CN') return badRequest('The provisioning locale must be zh-CN.')
        if (payload.replaceAttemptId) cancelProvisioning(payload.replaceAttemptId)
        const rec = startProvisioning()
        const deadline = Date.now() + 15000
        while (!rec.qrCodeUrl && Date.now() < deadline && !['error', 'expired', 'cancelled'].includes(rec.state)) await sleep(50)
        const provisioning = await publicProvisioning(rec)
        if (!provisioning) {
          // 把 registerApp 的真实失败透出（此前只报笼统 internal，排障全靠猜）
          if (rec.error) {
            return { ok: false, error: { code: rec.error.code ?? 'registration_failed', message: `Provisioning failed: ${rec.error.message}`, details: {} } }
          }
          return internalFailure('Provisioning did not produce a QR code.')
        }
        return { ok: true, value: provisioning }
      }
      if (endpoint === FEISHU_ENDPOINTS.pollProvisioning) {
        const rec = getAttempt(payload.attemptId)
        if (!rec) return badRequest('The provisioning attempt is no longer active.')
        const value = { status: pollStatus(rec), ...(rec.botId ? { botId: rec.botId } : {}) }
        const provisioning = await publicProvisioning(rec)
        if (provisioning) value.provisioning = provisioning
        if (rec.error) value.message = rec.error.message
        if (rec.state === 'succeeded' && rec.botId) value.connection = await publicStatus()
        return { ok: true, value }
      }
      if (endpoint === FEISHU_ENDPOINTS.cancelProvisioning) {
        if (!getAttempt(payload.attemptId)) return badRequest('The provisioning attempt is no longer active.')
        cancelProvisioning(payload.attemptId)
        return { ok: true, value: { status: 'failed', message: 'Registration was cancelled.' } }
      }
      if (endpoint === FEISHU_ENDPOINTS.reconnectBot) {
        const bot = deps.loadFeishuBots().find((b) => b.id === payload.botId)
        if (!bot) return badRequest('Unknown Feishu bot.')
        deps.stopBot(bot.id)
        const secret = await deps.resolveBotSecret(bot)
        if (!secret) return internalFailure('机器人凭据缺失，请重新绑定。')
        await deps.launchBot(bot, secret)
        return { ok: true, value: await publicStatus() }
      }
      if (endpoint === FEISHU_ENDPOINTS.disconnectBot) {
        if (!deps.loadFeishuBots().some((b) => b.id === payload.botId)) return badRequest('Unknown Feishu bot.')
        deps.stopBot(payload.botId)
        return { ok: true, value: await publicStatus() }
      }
      if (endpoint === FEISHU_ENDPOINTS.deleteBot) {
        if (payload.confirm !== true) return badRequest('Deleting a bot requires confirm=true.')
        await deleteBot(payload.botId)
        return { ok: true, value: await publicStatus() }
      }
      if (endpoint === FEISHU_ENDPOINTS.disconnect) {
        if (payload.removeCredentials !== true) return badRequest('Disconnect requires removeCredentials=true.')
        const first = deps.loadFeishuBots()[0]
        if (first) await deleteBot(first.id)
        return { ok: true, value: await publicStatus() }
      }
      return badRequest('Unknown Feishu endpoint.')
    } catch (err) {
      deps.log?.('warn', `connection RPC ${endpoint} 失败:`, String(err))
      return internalFailure(err?.message ?? 'The Feishu integration operation failed.')
    }
  }

  try {
    return registerRpc.call(ctx.connection.rpc, FEISHU_RPC_CHANNEL, handle, { authority: 'loopback' })
  } catch (err) {
    deps.log?.('warn', '注册 /feishu connection RPC 失败:', String(err))
    return null
  }
}
