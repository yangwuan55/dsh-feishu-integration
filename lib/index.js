/**
 * dsh-feishu-integration v1 — 飞书与 DeepSeek Harness 双向集成：总结推送 + 入站接管 + 回复路由
 *
 * 出站（原有行为，始终开启）：
 *   任意会话 turn/end(completed) 后向飞书发送总结；发送后记录
 *   飞书 message_id → DSH sessionId 映射（reply-map.json），供回复路由使用。
 *   由飞书回复触发的回合（rpcId 前缀 fsum-）不产生新总结，防乒乓。
 *
 * 入站（takeoverInbound=true 时开启，替代 @xmanrui/dsh-feishu）：
 *   WSClient 长连接接收 im.message.receive_v1：
 *   - 消息带 parent_id/root_id 且命中 reply-map → 直投对应 DSH 会话
 *     （session.prompt mode:queue），完成后把最终回答回帖到飞书线程；
 *   - 未命中 → 维持原 p2p/group 固定会话行为（读旧插件 state.json 无缝延续）。
 *
 * 依赖注入：credentials（凭据解析）、webServer（本机 RPC 端口）。
 * 飞书 SDK 经 node_modules/@larksuiteoapi 软链解析到 profile 的安装。
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import * as Lark from '@larksuiteoapi/node-sdk'
import QRCode from 'qrcode'

export const name = 'dsh-feishu-integration'
export const inject = ['connection', 'credentials', 'webServer']

const FEISHU_OPEN_BASE = 'https://open.feishu.cn/open-apis'
const PROMPT_RPC_PREFIX = 'fsum-' // 我们注入的消息 rpcId 前缀，防回环判别依据

/** Resolve a Feishu thread message to the mapped DSH session. */
export function findReplyMapping(message, lookup) {
  if (typeof lookup !== 'function') return null
  const parentId = message?.parent_id
  const rootId = message?.root_id
  return (parentId ? lookup(parentId) : null)
    ?? (rootId && rootId !== parentId ? lookup(rootId) : null)
    ?? null
}

/** Format the immediate Feishu acknowledgement after routing to a DSH session. */
export function formatRouteAcknowledgement({ workspacePath, sessionTitle, sessionId } = {}) {
  const space = workspacePath || '未知空间'
  const title = sessionTitle || '未命名会话'
  const id = sessionId || '未知 session'
  return `✅ 已转发到对应 DSH 会话。\n空间：${space}\n会话：${title}（${id}）`
}

export function apply(ctx, config = {}) {
  const {
    title = 'dsh 回复总结',
    maxText = 1500,
    includeReasons = ['completed'],
    openId = '',
    chatId = '',
    botSelection = 'all',
    // ── v2 新增 ──
    takeoverInbound = false,        // true=启动长连接接管入站（须先禁用旧插件！）
    harnessBaseUrl = '',            // 缺省用 ctx.webServer.port 自动推导
    workspace = process.cwd(),      // 创建新固定会话时的工作区路径
    agentPreset = 'standard',
    replyMapMax = 500,              // reply-map LRU 上限
    replyMapTtlDays = 7,            // 映射有效期
    replyTimeoutMs = 600000,        // 等待目标会话回答的超时
    replyMaxChars = 9000,           // 单条回帖分片上限
  } = config

  const log = (level, ...args) => {
    const logger = ctx.logger ?? console
    const fn = logger[level] ?? logger.log ?? console.log
    try { fn.call(logger, '[' + name + ']', ...args) } catch { /* ignore */ }
  }

  // ────────────────────────────────────────────────────────────
  // 共享基础设施：bot 配置、状态文件、reply-map、token 缓存
  // ────────────────────────────────────────────────────────────

  const dshHome = process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
  const feishuDir = join(dshHome, 'integrations', 'dsh-feishu')
  const replyMapPath = config.replyMapPath ?? join(feishuDir, 'reply-map.json')

  function loadFeishuBots() {
    try {
      const parsed = JSON.parse(readFileSync(join(feishuDir, 'config.json'), 'utf8'))
      return (parsed.bots ?? []).filter((b) => b && !b.deletionPending)
    } catch {
      return []
    }
  }

  /** bot 状态文件路径（兼容旧插件格式：sessions + seenMessageIds）。 */
  function statePathFor(bot) {
    if (!bot.id || !bot.secretRef) return join(feishuDir, 'state.json')
    return join(feishuDir, 'bots', bot.id, 'state.json')
  }

  function readBotState(bot) {
    try {
      const parsed = JSON.parse(readFileSync(statePathFor(bot), 'utf8'))
      parsed.sessions ??= {}
      parsed.seenMessageIds ??= []
      return parsed
    } catch {
      return { version: 1, sessions: {}, seenMessageIds: [] }
    }
  }

  function writeBotState(bot, state) {
    try {
      const p = statePathFor(bot)
      mkdirSync(join(p, '..'), { recursive: true })
      const tmp = p + '.tmp'
      writeFileSync(tmp, JSON.stringify(state, null, 2))
      renameSync(tmp, p)
    } catch (err) {
      log('warn', '写 bot state 失败(不影响主流程):', String(err))
    }
  }

  // ── reply-map：om_消息id → {sessionId, turn, ts} ──
  let replyMapCache = null

  function loadReplyMap() {
    if (replyMapCache) return replyMapCache
    try {
      replyMapCache = JSON.parse(readFileSync(replyMapPath, 'utf8'))
      if (!replyMapCache.entries) throw new Error('bad shape')
    } catch {
      replyMapCache = { version: 1, entries: {} }
    }
    return replyMapCache
  }

  function saveReplyMap() {
    try {
      mkdirSync(join(replyMapPath, '..'), { recursive: true })
      const tmp = replyMapPath + '.tmp'
      writeFileSync(tmp, JSON.stringify(replyMapCache, null, 2))
      renameSync(tmp, replyMapPath)
    } catch (err) {
      log('warn', '写 reply-map 失败:', String(err))
    }
  }

  function recordReplyMapping(messageId, meta) {
    if (!messageId || !meta?.sessionId) return
    const map = loadReplyMap()
    map.entries[messageId] = meta
    // LRU：按 ts 淘汰最旧，保持 ≤ replyMapMax
    const ids = Object.keys(map.entries)
    if (ids.length > replyMapMax) {
      ids.sort((a, b) => (map.entries[a].ts ?? 0) - (map.entries[b].ts ?? 0))
      for (const id of ids.slice(0, ids.length - replyMapMax)) delete map.entries[id]
    }
    saveReplyMap()
  }

  function lookupReplyMapping(messageId) {
    if (!messageId) return null
    const hit = loadReplyMap().entries[messageId]
    if (!hit) return null
    if (Date.now() - (hit.ts ?? 0) > replyMapTtlDays * 24 * 3600 * 1000) return null
    return hit
  }

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

  /** 目的地优先级与旧插件一致：config.chatId > config.openId > bot.ownerOpenIds[0]。 */
  function destinationFor(bot) {
    if (chatId) return { receiveId: chatId, receiveType: 'chat_id' }
    if (openId) return { receiveId: openId, receiveType: 'open_id' }
    if (bot.ownerOpenIds?.[0]) return { receiveId: bot.ownerOpenIds[0], receiveType: 'open_id' }
    return null
  }

  async function targetsWithCredentials() {
    const bots = loadFeishuBots()
    const selected = botSelection === 'first' ? bots.slice(0, 1) : bots
    const out = []
    for (const bot of selected) {
      const secret = await ctx.credentials.resolve(bot.secretRef)
      if (!secret?.value) {
        log('warn', '凭据缺失:', bot.secretRef)
        continue
      }
      out.push({ bot, appSecret: secret.value })
    }
    return out
  }

  // ────────────────────────────────────────────────────────────
  // 出站：总结推送 + 记账 + 防回环
  // ────────────────────────────────────────────────────────────

  const openTurnBySession = new Map()    // sessionId -> 最近 turn/start 的 turn 号
  const feishuTurnsBySession = new Map() // sessionId -> Set<turn>（由飞书回复触发的回合）

  ctx.on('session/event', (session, event) => {
    const sid = session?.id
    if (!sid || !event?.type) return

    if (event.type === 'turn/start') {
      openTurnBySession.set(sid, event.data?.turn ?? null)
      return
    }

    if (event.type === 'user/message') {
      const rpcId = event.data?.source?.rpcId
      if (typeof rpcId === 'string' && rpcId.startsWith(PROMPT_RPC_PREFIX)) {
        const turn = openTurnBySession.get(sid)
        if (turn != null) {
          const set = feishuTurnsBySession.get(sid) ?? new Set()
          set.add(turn)
          feishuTurnsBySession.set(sid, set)
        }
      }
      return
    }

    if (event.type === 'turn/end') {
      const turn = event.data?.turn
      const set = feishuTurnsBySession.get(sid)
      const fromFeishu = !!(set && set.has(turn))
      if (set) {
        set.delete(turn)
        if (set.size === 0) feishuTurnsBySession.delete(sid)
      }
      openTurnBySession.delete(sid)

      if (fromFeishu) return // 飞书回复引发的回合：绝不回发总结（防乒乓）
      const reason = event.data?.reason
      if (!reason || !includeReasons.includes(reason.kind)) return

      const reply = lastAssistantText(session, turn)
      if (!reply) return
      const cwd = session.header?.cwd ?? ''
      const text = [
        title,
        cwd ? 'cwd: ' + cwd : '',
        'turn: ' + turn,
        clip(reply, maxText),
      ].filter(Boolean).join('\n')

      void sendSummary(text, sid, turn).catch((err) =>
        log('warn', '飞书总结发送失败:', String(err)))
    }
  })

  async function sendSummary(text, sessionId, turn) {
    const targets = await targetsWithCredentials()
    if (targets.length === 0) {
      log('warn', '没有可用飞书机器人或凭据，跳过总结发送')
      return
    }
    await Promise.all(targets.map(async ({ bot, appSecret }) => {
      const dest = destinationFor(bot)
      if (!dest) {
        log('warn', 'bot 无可用接收目标，跳过:', bot.appId)
        return
      }
      const messageId = await sendTextMessage({
        appId: bot.appId, appSecret,
        receiveId: dest.receiveId, receiveType: dest.receiveType,
      }, text)
      recordReplyMapping(messageId, { sessionId, turn, ts: Date.now() })
    }))
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

  // ────────────────────────────────────────────────────────────
  // 入站接管：长连接 + 分拣路由 + 设置页 UI 的 /feishu RPC 通道
  // ────────────────────────────────────────────────────────────

  const origin = harnessBaseUrl
    ? new URL(harnessBaseSafe(harnessBaseUrl))
    : new URL('http://127.0.0.1:' + requireWebServerPort(ctx))

  // 运行时注册表：botId → {botId, wsClient, ready, feishuLongConnectionState, lastError}
  const runtimes = new Map()
  const botErrors = new Map()

  function launchBot(bot, appSecret) {
    if (runtimes.has(bot.id)) return Promise.resolve(runtimes.get(bot.id))
    const record = {
      botId: bot.id, ready: false, feishuLongConnectionState: 'connecting',
      harnessReachable: true, lastError: null, stop: null,
    }
    runtimes.set(bot.id, record)
    return startInboundForBot({
      origin, workspace, agentPreset, replyTimeoutMs, replyMaxChars,
      bot, appSecret, record,
      helpers: { log, lookupReplyMapping, recordReplyMapping, readBotState, writeBotState },
    }).catch((err) => {
      runtimes.delete(bot.id)
      throw err
    })
  }

  function stopBot(botId) {
    const rec = runtimes.get(botId)
    if (rec?.stop) { try { rec.stop() } catch { /* ignore */ } }
    runtimes.delete(botId)
  }

  async function resolveBotSecret(bot) {
    const secret = await ctx.credentials.resolve(bot.secretRef)
    return secret?.value ?? null
  }

  async function startAllBots() {
    const targets = await targetsWithCredentials()
    if (targets.length === 0) {
      log('warn', 'takeoverInbound=true 但没有可用 bot/凭据，入站未启动')
      return
    }
    for (const { bot, appSecret } of targets) {
      launchBot(bot, appSecret).catch((err) => log('warn', '入站接管启动失败:', String(err)))
    }
  }

  if (takeoverInbound) {
    void startAllBots().catch((err) => log('warn', '入站接管初始化失败:', String(err)))
  } else {
    log('info', 'takeoverInbound=false：仅出站总结模式')
  }

  // ── 设置页 UI 通道（与旧 @xmanrui/dsh-feishu 客户端契约兼容）──
  installConnectionRpc(ctx, {
    config2Dest: () => ({ chatId, openId }),
    runtimes, botErrors,
    loadFeishuBots, saveBots: (bots) => {
      try {
        mkdirSync(join(feishuDir, '..'), { recursive: true })
        const p = join(feishuDir, 'config.json')
        const cur = (() => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return {} } })()
        const tmp = p + '.tmp'
        writeFileSync(tmp, JSON.stringify({ ...cur, version: cur.version ?? 2, bots }, null, 2))
        renameSync(tmp, p)
      } catch (err) { log('warn', '写 feishu config 失败:', String(err)) }
    },
    credentials: ctx.credentials,
    registerAppFn: config.provisionRegisterApp ?? null,
    launchBot, stopBot, resolveBotSecret,
    dshHome,
  })
}

function harnessBaseSafe(u) {
  try { return new URL(u).origin } catch { return u }
}

function requireWebServerPort(ctx) {
  const port = ctx.webServer?.port
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('dsh-feishu-integration 需要 ctx.webServer.port 或配置 harnessBaseUrl')
  }
  return port
}

// ════════════════════════════════════════════════════════════
// 单 bot 入站运行时
// ════════════════════════════════════════════════════════════

async function startInboundForBot(opts) {
  const { origin, workspace, agentPreset, replyTimeoutMs, replyMaxChars,
    bot, appSecret, record, helpers } = opts
  const { log } = helpers

  const sdkDomain = bot.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu
  const client = new Lark.Client({ appId: bot.appId, appSecret, domain: sdkDomain })

  const botState = helpers.readBotState(bot)
  const allowedSenders = new Set((bot.ownerOpenIds ?? []).filter(Boolean))
  const queues = new Map()   // routeKey -> Promise 串行化
  const inflight = new Set() // 处理中的 message_id（内存去重）

  function markSeen(messageId) {
    const list = botState.seenMessageIds
    list.push(messageId)
    while (list.length > 200) list.shift()
  }

  const dispatcher = new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': (event) => {
      try { accept(event) } catch (err) { log('warn', 'accept 异常:', String(err)) }
      return {}
    },
    'im.message.reaction.created_v1': () => ({}),
    'im.message.reaction.deleted_v1': () => ({}),
  })

  const wsClient = new Lark.WSClient({
    appId: bot.appId,
    appSecret,
    domain: sdkDomain,
    loggerLevel: Lark.LoggerLevel.info,
    onReady: () => {
      if (record) { record.ready = true; record.feishuLongConnectionState = 'connected'; record.lastError = null }
      log('info', `飞书长连接已建立 bot=${bot.botName ?? bot.appId}`)
    },
    onError: (err) => {
      if (record) { record.ready = false; record.feishuLongConnectionState = 'failed'; record.lastError = err?.message ?? String(err) }
      log('warn', '飞书长连接错误:', err?.message ?? String(err))
    },
    onReconnecting: () => {
      if (record) { record.ready = false; record.feishuLongConnectionState = 'reconnecting' }
      log('info', '飞书长连接重连中…')
    },
    onReconnected: () => {
      if (record) { record.ready = true; record.feishuLongConnectionState = 'connected'; record.lastError = null }
      log('info', '飞书长连接已恢复')
    },
  })
  await wsClient.start({ eventDispatcher: dispatcher })
  const stopConnection = () => wsClient.close({ force: true })
  if (record) record.stop = stopConnection
  function accept(event) {
    const messageId = event?.message?.message_id
    if (!messageId) return
    if (event?.sender?.sender_type === 'bot') return
    if (event?.message?.message_type !== 'text') return
    if (allowedSenders.size > 0) {
      const senderOpenId = event?.sender?.sender_id?.open_id
      if (!senderOpenId || !allowedSenders.has(senderOpenId)) {
        log('warn', '拒绝白名单外发送者:', senderOpenId ?? '(空)')
        return
      }
    }
    if (inflight.has(messageId) || botState.seenMessageIds.includes(messageId)) return
    inflight.add(messageId)

    // 消息级路由：先查 parent_id；若 parent 是本插件回帖且未写入旧 map，再 fallback 到 root_id。
    const mapped = findReplyMapping(event.message, helpers.lookupReplyMapping)
    const routeKey = mapped ? 'direct:' + mapped.sessionId : conversationKey(event)

    const prev = queues.get(routeKey) ?? Promise.resolve()
    const task = prev
      .catch(() => undefined)
      .then(() => handle(event, mapped))
      .finally(() => {
        inflight.delete(messageId)
        if (queues.get(routeKey) === task) queues.delete(routeKey)
      })
    queues.set(routeKey, task)
  }

  async function handle(event, mapped) {
    const messageId = event.message.message_id
    markSeen(messageId)
    helpers.writeBotState(bot, botState)

    const text = extractText(event)
    if (!text) return
    if (text === '/status') {
      await sendChat(event.message.chat_id, '✅ dsh-feishu-integration 入站接管运行中。')
      return
    }
    if (text === '/help') {
      await sendChat(event.message.chat_id,
        '直接发消息 → 进入默认会话；\n长按引用某条总结回复 → 进入该总结对应的原始会话。')
      return
    }

    // 解析目标会话
    let sessionId
    let viaRoute = false
    if (mapped) {
      if (await sessionExistsSafe(mapped.sessionId)) {
        sessionId = mapped.sessionId
        viaRoute = true
      } else {
        await replyToMessage(messageId,
          '⚠️ 该总结对应的会话已不存在或不可访问，本次将进入默认会话。').catch(() => undefined)
      }
    }
    if (!sessionId) {
      const key = conversationKey(event)
      sessionId = botState.sessions[key] ?? ''
      if (!sessionId || !(await sessionExistsSafe(sessionId))) {
        sessionId = await createFixedSession(key)
        botState.sessions[key] = sessionId
        helpers.writeBotState(bot, botState)
      }
    }

    if (sessionId) {
      helpers.recordReplyMapping?.(messageId, {
        sessionId,
        turn: mapped?.turn ?? null,
        ts: Date.now(),
        source: 'feishu-inbound',
      })
    }

    log('info', `${viaRoute ? '[路由]' : '[默认]'} ${messageId} → ${sessionId}`)
    const routeInfo = await sessionRouteInfo(sessionId)
    await replyToSession(
      messageId,
      formatRouteAcknowledgement({ ...routeInfo, sessionId }),
      sessionId,
      mapped?.turn,
    ).catch((err) => log('warn', '发送路由确认失败:', String(err)))
    const reaction = await addReactionSafe(messageId, 'OnIt')

    try {
      const answer = await ask(sessionId, text)
      await finishReaction(messageId, reaction, 'DONE')
      await replyToSession(messageId, answer || '（该回合结束但没有文本回复）', sessionId, mapped?.turn)
    } catch (err) {
      log('warn', '处理回复失败:', String(err))
      await finishReaction(messageId, reaction, 'ERROR')
      await replyToSession(messageId, '❌ 处理失败：' + clip(String(err?.message ?? err), 300), sessionId, mapped?.turn)
        .catch(() => undefined)
    }
  }

  async function createFixedSession(key) {
    const { items } = await rpc('workspace.list', {})
    let workspaceId = items.find((i) => i.path === workspace)?.workspaceId
    if (!workspaceId) {
      const created = await rpc('workspace.create', { path: workspace })
      workspaceId = created.workspace.workspaceId
    }
    const r = await rpc('session.create', { workspaceId, agentPreset })
    log('info', `为 ${key} 创建默认会话 ${r.sessionId}`)
    return r.sessionId
  }

  // ── HTTP RPC（GUI 同款通路，loopback 无需鉴权） ──
  async function rpc(method, payload = {}, timeoutMs = 30000, options = {}) {
    const rpcId = options.rpcId ?? PROMPT_RPC_PREFIX + 'rpc-' + randomUUID()
    const response = await fetch(new URL('/api/' + method, origin), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`Harness transport ${method}: HTTP ${response.status}`)
    const body = await response.json()
    if (body?.type !== 'server-response' || body?.rpcId !== rpcId) {
      throw new Error(`Harness 返回了无效响应 (${method})`)
    }
    if (!body.result?.ok) {
      const err = new Error(`${method}: ${body.result?.error?.message ?? 'unknown error'}`)
      err.code = body.result?.error?.code
      throw err
    }
    return body.result.value
  }

  async function sessionExistsSafe(sessionId) {
    try {
      await rpc('session.history', { sessionId, maxMessages: 1 })
      return true
    } catch (err) {
      if (err.code === 'session-not-found') return false
      throw err
    }
  }

  async function sessionRouteInfo(sessionId) {
    try {
      const { items } = await rpc('session.list', {})
      const item = (items ?? []).find((candidate) => candidate.sessionId === sessionId)
      return {
        workspacePath: item?.cwd || workspace,
        sessionTitle: item?.projections?.values?.title || '未命名会话',
      }
    } catch (err) {
      log('warn', '读取会话路由信息失败，使用配置空间:', String(err))
      return { workspacePath: workspace, sessionTitle: '未命名会话' }
    }
  }

  /**
   * 注入并等待最终回答。
   * 以 baseline seq 跳过旧事件；以本条 prompt 的 rpcId 锚定目标回合；
   * 轮询 session.history 直到该回合 turn/end，返回累计 assistant 文本。
   */
  async function ask(sessionId, text) {
    const before = await rpc('session.history', { sessionId, maxMessages: 1 })
    let lastSeq = Math.max(-1, ...(before.events ?? []).map(({ event }) => event.seq ?? -1))
    const promptRpcId = PROMPT_RPC_PREFIX + randomUUID()

    await rpc('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }, 30000, { rpcId: promptRpcId })

    const stepText = new Map()
    let latestText = ''
    let targetTurn = null
    let openTurn = null
    let finished = false
    const deadline = Date.now() + replyTimeoutMs

    const consume = (events) => {
      for (const entry of [...events]
        .map((e) => e?.event ?? e)
        .filter(Boolean)
        .sort((a, b) => (a.seq ?? -1) - (b.seq ?? -1))) {
        const seq = entry.seq ?? -1
        if (seq <= lastSeq) continue
        lastSeq = seq

        if (entry.type === 'turn/start') {
          openTurn = entry.data?.turn ?? null
          continue
        }
        if (entry.type === 'user/message' && entry.data?.source?.rpcId === promptRpcId) {
          targetTurn = openTurn
          continue
        }
        if (targetTurn == null) continue

        if (entry.type === 'turn/end') {
          if (entry.data?.turn !== targetTurn) continue
          finished = true
          continue
        }
        if (entry.data?.turn !== targetTurn) continue

        if (entry.type === 'assistant/chunk' && entry.data?.chunk?.type === 'text-delta') {
          const step = entry.data.step ?? 0
          const idx = entry.data.chunk.index ?? 0
          const k = step + ':' + idx
          stepText.set(k, (stepText.get(k) ?? '') + entry.data.chunk.text)
          const merged = [...stepText.entries()]
            .filter(([key]) => key.startsWith(step + ':'))
            .sort((a, b) => Number(a[0].split(':')[1]) - Number(b[0].split(':')[1]))
            .map(([, v]) => v).join('\n').trim()
          if (merged && merged !== latestText) latestText = merged
          continue
        }
        if (entry.type === 'assistant/message') {
          const t = (entry.data?.message?.content ?? [])
            .filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
          if (t && t !== latestText) latestText = t
        }
      }
    }

    while (!finished && Date.now() < deadline) {
      await sleep(400)
      try {
        const history = await rpc('session.history', { sessionId, maxMessages: 50 })
        consume(history.events ?? [])
      } catch (err) {
        log('warn', 'history 轮询失败(重试):', String(err))
      }
    }
    if (!finished) throw new Error(`等待会话回复超时(${Math.round(replyTimeoutMs / 1000)}s)`)
    return latestText.trim()
  }

  // ── 飞书写操作 ──
  async function apiCall(op, fn) {
    const res = await fn()
    if (res?.code && res.code !== 0) throw new Error(`${op} failed: ${res.msg || res.code}`)
    return res
  }

  async function sendChat(chatId, text) {
    for (const chunk of splitText(text, replyMaxChars)) {
      await apiCall('im.message.create', () => client.im.v1.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: chunk }) },
      }))
    }
  }

  async function replyToMessage(messageId, text) {
    const replyIds = []
    for (const chunk of splitText(text, replyMaxChars)) {
      const response = await apiCall('im.message.reply', () => client.im.v1.message.reply({
        path: { message_id: messageId },
        data: { msg_type: 'text', content: JSON.stringify({ text: chunk }) },
      }))
      const replyId = response?.data?.message_id ?? response?.data?.message?.message_id
      if (replyId) replyIds.push(replyId)
    }
    return replyIds
  }

  async function replyToSession(messageId, text, sessionId, turn) {
    const replyIds = await replyToMessage(messageId, text)
    for (const replyId of replyIds) {
      helpers.recordReplyMapping?.(replyId, {
        sessionId,
        turn: turn ?? null,
        ts: Date.now(),
        source: 'feishu-outbound-reply',
      })
    }
    return replyIds
  }

  async function addReactionSafe(messageId, emojiType) {
    try {
      const res = await apiCall('reaction.create', () => client.im.v1.messageReaction.create({
        path: { message_id: messageId },
        data: { reaction_type: { emoji_type: emojiType } },
      }))
      return res?.data?.reaction_id ?? null
    } catch (err) {
      log('warn', '添加表情失败:', String(err))
      return null
    }
  }

  async function finishReaction(messageId, reactionId, finalEmoji) {
    if (reactionId) {
      await apiCall('reaction.delete', () => client.im.v1.messageReaction.delete({
        path: { message_id: messageId, reaction_id: reactionId },
      })).catch(() => undefined)
    }
    await addReactionSafe(messageId, finalEmoji)
  }

  // ── 工具 ──
  function conversationKey(event) {
    const chatType = event?.message?.chat_type
    if (chatType === 'p2p') {
      const senderId = event?.sender?.sender_id?.open_id || event?.sender?.sender_id?.user_id
      if (!senderId) throw new Error('p2p 事件缺少发送者 id')
      return 'p2p:' + senderId
    }
    const chatId = event?.message?.chat_id
    if (!chatId) throw new Error('群聊事件缺少 chat_id')
    return 'group:' + chatId
  }
}

// ════════════════════════════════════════════════════════════
// DSH 设置页 Connection RPC（兼容 @xmanrui/dsh-feishu 客户端）
// ════════════════════════════════════════════════════════════

const FEISHU_RPC_CHANNEL = '/feishu'
const FEISHU_ENDPOINTS = Object.freeze({
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

function installConnectionRpc(ctx, deps) {
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
      domain: 'feishu', source: 'deepseek-harness', createOnly: true,
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
        if (!provisioning) return internalFailure('Provisioning did not produce a QR code.')
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }


/** 取某回合最后一条 assistant 消息的纯文本。 */
function lastAssistantText(session, turn) {
  for (const e of [...session.events].reverse()) {
    if (e.type === 'assistant/message' && e.data?.turn === turn) {
      return (e.data.message?.content ?? [])
        .filter((b) => b.type === 'text').map((b) => b.text).join('')
    }
  }
  return ''
}

function extractText(event) {
  if (event?.message?.message_type !== 'text') return null
  let parsed
  try { parsed = JSON.parse(event.message.content) } catch { return null }
  let text = typeof parsed.text === 'string' ? parsed.text : ''
  for (const mention of event.message.mentions ?? []) {
    if (typeof mention.key === 'string' && mention.key) text = text.replaceAll(mention.key, '')
  }
  return text.trim() || null
}

function splitText(text, maxChars = 9000) {
  const t = String(text ?? '')
  if (t.length <= maxChars) return [t]
  const chunks = []
  let rest = t
  while (rest.length > maxChars) {
    let at = rest.lastIndexOf('\n', maxChars)
    if (at < Math.floor(maxChars * 0.6)) at = maxChars
    chunks.push(rest.slice(0, at))
    rest = rest.slice(at).replace(/^\n+/, '')
  }
  if (rest) chunks.push(rest)
  return chunks
}

function clip(text, max) {
  return String(text).length > max ? String(text).slice(0, max) + '\n…' : String(text)
}
