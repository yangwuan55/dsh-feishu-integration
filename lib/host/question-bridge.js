/**
 * 提问桥：DSH 挂起的 ask_user_question ↔ 飞书线程双向转接。
 *
 * question/requested → 格式化发到该 session 的飞书线程并登记 pending；
 * 用户回帖 → inbound-runtime 先经 interceptReply() 询问本桥，命中则
 * 组装 /api/respond 作答（不再注入 session.prompt）；
 * question/resolved → 清算状态；非我方结算时补一条说明。
 *
 * 传输细节在 mux-client；文本格式化与解析是 shared/question-format 纯函数。
 */

import { createMuxClient } from './mux-client.js'
import {
  formatQuestionText,
  parseAnswerChoice,
  formatAnswerConfirmation,
} from '../shared/question-format.js'

/**
 * @param deps.origin            DSH 本机 origin（http://127.0.0.1:port）
 * @param deps.log               logger
 * @param deps.postToSession(text, sessionId, parentMessageId|null)
 *               → {messageId}|null  发帖（parentMessageId 为空时落到默认目标）
 * @param deps.recordReplyMapping(messageId, meta)
 * @param deps.latestThreadLookup(sessionId) → feishuMessageId|null
 */
export function createQuestionBridge({
  origin, log, openSocket,
  postToSession, recordReplyMapping, latestThreadLookup,
}) {

  /** feishuQuestionMsgId → { rpcId, sessionId, questions } */
  const pendingByFeishuId = new Map()
  /** rpcId → { feishuMsgId, answeredByUs } —— 含已结算，防重连重放重复发帖 */
  const seenRpcIds = new Map()

  async function handleQuestionRequested(rpcId, payload) {
    const { sessionId, questions } = payload ?? {}
    if (!sessionId || !Array.isArray(questions) || questions.length === 0) return
    // 同步先占位：重连重放可能并发到达，await 发帖期间第二个帧也必须被去重
    if (seenRpcIds.has(rpcId)) return
    const record = { feishuMsgId: null, answeredByUs: false }
    seenRpcIds.set(rpcId, record)
    while (seenRpcIds.size > 500) {
      seenRpcIds.delete(seenRpcIds.keys().next().value)
    }

    const answerable = questions.length === 1
    const text = formatQuestionText(questions)
      ?? `❓ 会话在等待你的回答（共 ${questions.length} 个问题，暂不支持在飞书作答，请到 DSH 网页端回答）`

    let posted = null
    try {
      const parent = answerable ? (latestThreadLookup?.(sessionId) ?? null) : null
      posted = await postToSession(text, sessionId, parent)
    } catch (err) {
      log('warn', '提问转发到飞书失败:', String(err))
      seenRpcIds.delete(rpcId) // 发帖失败：允许下次重放重试
      return
    }
    const feishuMsgId = posted?.messageId
    if (!feishuMsgId) {
      seenRpcIds.delete(rpcId)
      return
    }

    record.feishuMsgId = feishuMsgId
    if (answerable) {
      pendingByFeishuId.set(feishuMsgId, { rpcId, sessionId, questions })
    }
    recordReplyMapping?.(feishuMsgId, {
      sessionId, turn: null, ts: Date.now(), source: 'feishu-question',
    })
    log('info', `[提问] ${rpcId} → 飞书 ${feishuMsgId} (${sessionId})`)
  }

  /**
   * 入站拦截点：用户回帖若针对挂起提问，消费之并提交作答。
   * 返回 true 表示已按回答处理，调用方应跳过常规路由。
   */
  async function interceptReply({ parentMessageId, rootMessageId, messageId, text }) {
    const hit = pendingByFeishuId.get(parentMessageId) ?? pendingByFeishuId.get(rootMessageId)
    if (!hit) return false
    const { rpcId, sessionId, questions } = hit
    const question = questions[0]
    const consumedKey = parentMessageId ?? rootMessageId

    const parsed = parseAnswerChoice(text, question)
    if (!parsed.ok) {
      await postToSession(
        '⚠️ 无法识别的回答：' + parsed.reason + '。请回复选项编号，或直接输入自定义文字。',
        sessionId, messageId,
      ).catch(() => undefined)
      return true // 已消费，避免无效文本被注入会话
    }

    const answer = {
      answers: [{
        id: question.id,
        selected: parsed.selected,
        ...(parsed.custom !== undefined ? { custom: parsed.custom } : {}),
      }],
    }
    let receipt
    try {
      receipt = await respondViaMux({
        rpcId,
        result: { ok: true, value: { sessionId, answer } },
      })
    } catch (err) {
      log('warn', '提交回答失败:', String(err))
      await postToSession(
        '⚠️ 提交回答失败：' + String(err?.message ?? err), sessionId, messageId,
      ).catch(() => undefined)
      return true
    }
    if (receipt?.accepted === false) {
      // GUI 抢答或请求已失效
      pendingByFeishuId.delete(consumedKey)
      await postToSession(
        'ℹ️ 该问题已在 DSH 网页端处理，无需重复回答。', sessionId, messageId,
      ).catch(() => undefined)
      return true
    }

    seenRpcIds.get(rpcId).answeredByUs = true
    pendingByFeishuId.delete(consumedKey)
    recordReplyMapping?.(messageId, {
      sessionId, turn: null, ts: Date.now(), source: 'feishu-question-answer',
    })
    await postToSession(
      formatAnswerConfirmation(question, parsed), sessionId, messageId,
    ).catch(() => undefined)
    return true
  }

  function handleResolved(payload) {
    const { sessionId, questionRpcId, outcome } = payload ?? {}
    const record = seenRpcIds.get(questionRpcId)
    if (!record) return
    pendingByFeishuId.delete(record.feishuMsgId)
    if (!record.answeredByUs) {
      const note = outcome === 'cancelled'
        ? 'ℹ️ 该问题已被取消。'
        : 'ℹ️ 该问题已在 DSH 网页端被回答，会话继续执行中。'
      void postToSession(note, sessionId, record.feishuMsgId).catch(() => undefined)
    }
  }

  function onFrame(frame) {
    const { payload } = frame ?? {}
    if (payload?.type === 'question/requested') {
      return handleQuestionRequested(frame.rpcId, payload)
    }
    if (payload?.type === 'question/resolved') {
      return Promise.resolve(handleResolved(payload))
    }
    return undefined
  }

  const mux = createMuxClient({
    origin,
    openSocket,
    onFrame: (frame) => {
      Promise.resolve(onFrame(frame)).catch((err) =>
        log('warn', '提问帧处理异常:', String(err)))
    },
    log,
  })

  /** 测试缝：替换 respond 实现（默认走 mux.respond → POST /api/respond）。 */
  let respondOverride = null
  function respondViaMux(message) {
    if (respondOverride) return respondOverride(message)
    return mux.respond(message)
  }

  return {
    interceptReply,
    close: () => mux.close(),
    done: mux.done,
    __setRespondForTest: (fn) => { respondOverride = fn },
    /** 测试缝 */
    __pendingCount: () => pendingByFeishuId.size,
  }
}
