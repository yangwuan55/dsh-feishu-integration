/**
 * 提问桥：DSH 挂起的 ask_user_question ↔ 飞书线程双向转接。
 *
 * question/requested → 逐题发到该会话的飞书线程并登记批次状态；
 * 用户回帖 → inbound-runtime 先经 interceptReply() 询问本桥：
 *   - 「取消」→ 整批取消（等价网页端取消）；
 *   - 回答当前题 → 记录并推进到下一题；全部答完一次性 POST /api/respond；
 * question/resolved → 清算状态；非我方结算时补一条说明。
 *
 * 传输细节在 mux-client；文本格式化与解析是 shared/question-format 纯函数。
 */

import { createMuxClient } from './mux-client.js'
import {
  formatQuestionText,
  parseAnswerChoice,
  isCancelCommand,
  formatBatchConfirmation,
} from '../shared/question-format.js'

/**
 * @param deps.origin            DSH 本机 origin（http://127.0.0.1:port）
 * @param deps.log               logger
 * @param deps.debugLog?         (...args) → void  落盘调试日志（ctx 日志不落盘时用它排查）
 * @param deps.postToSession(text, sessionId, parentMessageId|null, metaBag)
 *               → {messageId}|null  发帖（metaBag 回填 rootId/parentId 线程信息）
 * @param deps.recordReplyMapping(messageId, meta)
 * @param deps.latestThreadLookup(sessionId) → feishuMessageId|null
 */
export function createQuestionBridge({
  origin, log, openSocket,
  postToSession, recordReplyMapping, latestThreadLookup,
  debugLog = null,
}) {

  /** feishuMsgId（含线程别名键）→ batchCtx {rpcId, sessionId, questions, cursor, answers, msgIds, keys} */
  const pendingByFeishuId = new Map()
  /** 活跃批次计数（一个批次可能注册多个键） */
  const activeBatches = new Set()
  /** rpcId → { msgIds:[], answeredByUs } —— 含已结算，防重连重放重复发帖 */
  const seenRpcIds = new Map()

  function clearBatch(batch) {
    for (const key of batch.keys) pendingByFeishuId.delete(key)
    activeBatches.delete(batch)
  }

  /**
   * 发送第 index 题（1-based）并登记命中键。
   * 关键：飞书话题线程里用户回帖事件带的 parent/root 可能是线程根而不是
   * 提问消息本身，所以把【提问消息 id + 发帖父消息 + 服务端返回的 root/parent】
   * 全部注册为命中键，任一键命中都能继续作答。
   */
  async function postRound(batch, index) {
    const text = formatQuestionText([batch.questions[index - 1]], {
      index, total: batch.questions.length,
    })
    // 首题优先落该会话最近使用的飞书线程；后续轮次直接跟在上一条后面
    const parent = index === 1
      ? (latestThreadLookup?.(batch.sessionId) ?? null)
      : batch.msgIds[batch.msgIds.length - 1] ?? null
    let posted = null
    const meta = {}
    try {
      posted = await postToSession(text, batch.sessionId, parent, meta)
    } catch (err) {
      log('warn', '提问转发到飞书失败:', String(err))
      throw err
    }
    if (posted?.messageId) {
      batch.msgIds.push(posted.messageId)
      const keys = new Set(
        [posted.messageId, meta.rootId, meta.parentId, parent]
          .filter((k) => typeof k === 'string' && k),
      )
      for (const key of keys) pendingByFeishuId.set(key, batch)
      if (!batch.keys) batch.keys = new Set()
      for (const key of keys) batch.keys.add(key)
      debugLog?.('register', JSON.stringify({ rpcId: batch.rpcId, round: index, messageId: posted.messageId, parent, returnedRoot: meta.rootId ?? null, returnedParent: meta.parentId ?? null, keys: [...keys] }))
    }
    return posted?.messageId ?? null
  }

  async function handleQuestionRequested(rpcId, payload) {
    const { sessionId, questions } = payload ?? {}
    if (!sessionId || !Array.isArray(questions) || questions.length === 0) return
    // 同步先占位：重连重放可能并发到达，await 发帖期间第二个帧也必须被去重
    if (seenRpcIds.has(rpcId)) return
    const batch = { rpcId, sessionId, questions, cursor: 0, answers: [], msgIds: [], keys: new Set() }
    // seen 与 batch 共享同一个 msgIds 数组：resolved 清算与作答清算看到同一份登记
    const seen = { msgIds: batch.msgIds, batch, answeredByUs: false }
    seenRpcIds.set(rpcId, seen)
    while (seenRpcIds.size > 500) {
      seenRpcIds.delete(seenRpcIds.keys().next().value)
    }

    try {
      await postRound(batch, 1)
    } catch {
      seenRpcIds.delete(rpcId) // 发帖失败：允许下次重放重试
      return
    }
    if (batch.msgIds.length === 0) {
      seenRpcIds.delete(rpcId)
      return
    }
    activeBatches.add(batch)
    recordReplyMapping?.(batch.msgIds[0], {
      sessionId, turn: null, ts: Date.now(), source: 'feishu-question',
    })
    log('info', `[提问] ${rpcId} ${questions.length} 题 → 飞书 (${sessionId})`)
  }

  /**
   * 入站拦截点：用户回帖若针对挂起提问，消费之。
   * 返回 true 表示已按回答处理，调用方应跳过常规路由。
   */
  async function interceptReply({ parentMessageId, rootMessageId, messageId, text }) {
    const hit = pendingByFeishuId.get(parentMessageId) ?? pendingByFeishuId.get(rootMessageId)
    debugLog?.('intercept', JSON.stringify({
      parent: parentMessageId ?? null, root: rootMessageId ?? null,
      text: String(text ?? '').slice(0, 60),
      hit: hit ? hit.rpcId : null,
      registeredSample: hit ? null : [...pendingByFeishuId.keys()].slice(0, 6),
    }))
    if (!hit) return false

    // ── 整批取消 ──
    if (isCancelCommand(text)) {
      clearBatch(hit)
      seenRpcIds.get(hit.rpcId).answeredByUs = true // 我方主动取消，resolved 时不再补提示
      let receipt = null
      try {
        const out = await respondViaMux({
          rpcId: hit.rpcId,
          result: { ok: false, error: { code: 'cancelled', message: '用户在飞书取消了这批提问', details: {} } },
        })
        receipt = out?.receipt ?? out
      } catch (err) {
        log('warn', '取消提问失败:', String(err))
      }
      const note = receipt?.accepted === false
        ? 'ℹ️ 该问题已在 DSH 网页端处理，取消未生效。'
        : '✅ 已取消这批提问，会话将收到取消信号。'
      await postToSession(note, hit.sessionId, messageId).catch(() => undefined)
      return true
    }

    const question = hit.questions[hit.cursor]
    const parsed = parseAnswerChoice(text, question)
    if (!parsed.ok) {
      await postToSession(
        '⚠️ 无法识别的回答：' + parsed.reason + '。请回复选项编号，或直接输入自定义文字。',
        hit.sessionId, messageId,
      ).catch(() => undefined)
      return true // 已消费，避免无效文本被注入会话
    }

    hit.answers[hit.cursor] = { question, parsed }
    hit.cursor += 1

    // ── 还有下一题：发出下一轮，等待继续作答 ──
    if (hit.cursor < hit.questions.length) {
      try {
        await postRound(hit, hit.cursor + 1)
      } catch (err) {
        // 发下一题失败：回滚本题进度，允许用户重答触发重发
        hit.cursor -= 1
        hit.answers.pop()
        await postToSession(
          '⚠️ 下一题发送失败：' + String(err?.message ?? err) + '。请重新回答本题为重试。',
          hit.sessionId, messageId,
        ).catch(() => undefined)
      }
      return true
    }

    // ── 全部答完：一次性提交 ──
    const answer = {
      answers: hit.answers.map(({ question: q, parsed: p }) => ({
        id: q.id,
        selected: p.selected,
        ...(p.custom !== undefined ? { custom: p.custom } : {}),
      })),
    }
    let outcome
    try {
      outcome = await respondViaMux({
        rpcId: hit.rpcId,
        result: { ok: true, value: { sessionId: hit.sessionId, answer } },
      })
    } catch (err) {
      log('warn', '提交回答失败:', String(err))
      // 提交失败：回滚最后一题，用户重新作答即可整体重提
      hit.cursor -= 1
      hit.answers.pop()
      await postToSession(
        '⚠️ 提交回答失败：' + String(err?.message ?? err) + '。请重新回答本题以整体重试。',
        hit.sessionId, messageId,
      ).catch(() => undefined)
      return true
    }
    const receipt = outcome?.receipt ?? outcome
    const retriedAfterError = outcome?.retried === true

    const seen = seenRpcIds.get(hit.rpcId)
    if (receipt?.accepted === false) {
      // bad-response = 我方载荷被服务端 schema 拒收，是插件 bug，绝不能
      // 伪装成「网页端已处理」；回滚最后一题让用户重答，同时留下日志。
      if (receipt?.reason === 'bad-response') {
        log('error', `[提问] respond 被拒（bad-response）：载荷不符合服务端 schema`, JSON.stringify({ rpcId: hit.rpcId }))
        debugLog?.('respond-rejected', JSON.stringify({ rpcId: hit.rpcId, reason: 'bad-response' }))
        hit.cursor -= 1
        hit.answers.pop()
        await postToSession(
          '⚠️ 回答提交被拒绝（协议格式错误），请稍后重答本题。', hit.sessionId, messageId,
        ).catch(() => undefined)
        return true
      }
      clearBatch(hit)
      // not-pending：真抢答或请求已失效。重试后拿到它更可能是首次已被受理
      // （响应丢失），按成功口径确认而非误导「已在网页端处理」。
      const note = retriedAfterError
        ? '✅ 回答已提交（首次回执超时，若网页端未见生效请忽略本条）。'
        : 'ℹ️ 该问题已在 DSH 网页端处理，无需重复回答。'
      await postToSession(note, hit.sessionId, messageId).catch(() => undefined)
      return true
    }

    if (seen) seen.answeredByUs = true
    clearBatch(hit)
    recordReplyMapping?.(messageId, {
      sessionId: hit.sessionId, turn: null, ts: Date.now(), source: 'feishu-question-answer',
    })
    await postToSession(
      formatBatchConfirmation(hit.answers), hit.sessionId, messageId,
    ).catch(() => undefined)
    return true
  }

  function respondViaMux(message) {
    if (respondOverride) return respondOverride(message)
    return mux.respond(message)
  }
  let respondOverride = null

  function handleResolved(payload) {
    const { sessionId, questionRpcId, outcome } = payload ?? {}
    const seen = seenRpcIds.get(questionRpcId)
    if (!seen) return
    for (const msgId of seen.msgIds) pendingByFeishuId.delete(msgId)
    if (seen.batch) activeBatches.delete(seen.batch)
    debugLog?.('resolved', JSON.stringify({ rpcId: questionRpcId, outcome: outcome ?? null }))
    if (!seen.answeredByUs) {
      const note = outcome === 'cancelled'
        ? 'ℹ️ 该问题已被取消。'
        : 'ℹ️ 该问题已在 DSH 网页端被回答，会话继续执行中。'
      void postToSession(note, sessionId, seen.msgIds[seen.msgIds.length - 1] ?? null).catch(() => undefined)
    }
  }

  /** 下行帧分发（mux-client 已剥壳为 {rpcId, payload}）：按 payload.type 路由。 */
  function dispatchFrame(frame) {
    const type = frame?.payload?.type
    if (type === 'question/requested') {
      void handleQuestionRequested(String(frame.rpcId ?? ''), frame.payload)
    } else if (type === 'question/resolved') {
      handleResolved(frame.payload)
    }
  }

  const mux = createMuxClient({
    origin,
    openSocket,
    onFrame: (frame) => {
      Promise.resolve(dispatchFrame(frame)).catch((err) =>
        log('warn', '提问帧处理异常:', String(err)))
    },
    log,
  })

  return {
    interceptReply,
    close: () => mux.close(),
    done: mux.done,
    __setRespondForTest: (fn) => { respondOverride = fn },
    /** 测试缝：当前登记的飞书消息数 */
    __pendingCount: () => activeBatches.size,
  }
}
