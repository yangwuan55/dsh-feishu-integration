/**
 * 出站总结推送：session turn/end → 飞书文本总结 + reply-map 记账。
 * 防回环：由飞书回复触发的回合（rpcId 前缀 fsum-）不产生新总结。
 */

import { PROMPT_RPC_PREFIX } from '../shared/constants.js'
import { lastAssistantText, clip } from '../shared/text.js'

/**
 * @param deps.loadBots()            bot 列表（已过滤 deletionPending）
 * @param deps.resolveSecret(bot)    → secret 字符串 | null
 * @param deps.sendTextMessage(...)  feishu-api 直发
 * @param deps.recordReplyMapping    reply-map 记账
 */
export function installSummaryPush(ctx, deps) {
  const {
    title, maxText, includeReasons, botSelection,
    openId = '', chatId = '',
    loadBots, resolveSecret, sendTextMessage, recordReplyMapping, log,
  } = deps

  /** 目的地优先级与旧插件一致：config.chatId > config.openId > bot.ownerOpenIds[0]。 */
  function destinationFor(bot) {
    if (chatId) return { receiveId: chatId, receiveType: 'chat_id' }
    if (openId) return { receiveId: openId, receiveType: 'open_id' }
    if (bot.ownerOpenIds?.[0]) return { receiveId: bot.ownerOpenIds[0], receiveType: 'open_id' }
    return null
  }

  async function targetsWithCredentials() {
    const bots = loadBots()
    const selected = botSelection === 'first' ? bots.slice(0, 1) : bots
    const out = []
    for (const bot of selected) {
      const secret = await resolveSecret(bot)
      if (!secret?.value) {
        log('warn', '凭据缺失:', bot.secretRef)
        continue
      }
      out.push({ bot, appSecret: secret.value })
    }
    return out
  }

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

  // 入站接管启动复用同一份凭据筛选（与原实现单一来源一致）
  return { targetsWithCredentials }
}
