/**
 * 单 bot 入站运行时：唯一的飞书 WSClient 长连接 + 事件分拣 + 消息级路由。
 * 硬约束：一个 bot 只允许一个长连接（集群模式下多 client 会随机分流事件）。
 *
 * opts.larkSdk 仅测试用：注入假 SDK 以验证调用顺序，缺省用真实 @larksuiteoapi。
 */

import * as LarkDefault from '@larksuiteoapi/node-sdk'
import { findReplyMapping, formatRouteAcknowledgement } from '../shared/reply-routing.js'
import { extractText, splitText, clip } from '../shared/text.js'
import { createSessionGateway } from './session-gateway.js'

export async function startInboundForBot(opts) {
  const {
    origin, workspace, agentPreset, replyTimeoutMs, replyMaxChars,
    bot, appSecret, record, helpers, larkSdk,
  } = opts
  const Lark = larkSdk ?? LarkDefault
  const { log } = helpers

  // 每个 bot runtime 独享一个无状态网关（配置相同、互不共享状态）
  const gateway = createSessionGateway({ origin, workspace, agentPreset, replyTimeoutMs, log })
  const { rpc, sessionExistsSafe, sessionRouteInfo, createFixedSession, ask } = gateway

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
    // 排队前的任何异常都必须释放 inflight，否则该消息重投递会被永久去重。
    let task
    try {
      const mapped = findReplyMapping(event.message, helpers.lookupReplyMapping)
      const routeKey = mapped ? 'direct:' + mapped.sessionId : conversationKey(event)

      const prev = queues.get(routeKey) ?? Promise.resolve()
      task = prev
        .catch(() => undefined)
        .then(() => handle(event, mapped))
        .finally(() => {
          inflight.delete(messageId)
          if (queues.get(routeKey) === task) queues.delete(routeKey)
        })
      queues.set(routeKey, task)
    } catch (err) {
      inflight.delete(messageId)
      log('warn', '入站分拣失败:', err?.message ?? String(err))
    }
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

    // 提问桥拦截：回帖若针对挂起的 ask_user_question，作为回答提交，不进入常规路由
    const parentMessageId = event.message.parent_id ?? null
    const rootMessageId = event.message.root_id ?? null
    if (
      (parentMessageId || rootMessageId)
      && await helpers.interceptReply?.({ parentMessageId, rootMessageId, messageId, text }) === true
    ) {
      log('info', `[提问回答] ${messageId} 已由提问桥消费`)
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
      // 等待回答超时：转发回执已是送达确认，飞书侧保持静默（保留 OnIt，不追加错误反馈）
      if (err?.code === 'ask-timeout') return
      await finishReaction(messageId, reaction, 'ERROR')
      await replyToSession(messageId, '❌ 处理失败：' + clip(String(err?.message ?? err), 300), sessionId, mapped?.turn)
        .catch(() => undefined)
    }
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
