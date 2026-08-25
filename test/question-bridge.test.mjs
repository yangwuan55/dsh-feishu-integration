/**
 * 提问桥集成测试：注入式假 WebSocket + 桩 postToSession，
 * 验证 question/requested 转发、飞书回复作答提交 /api/respond（桩）、
 * 重放去重、多问题降级与结算清算。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createQuestionBridge } from '../lib/host/question-bridge.js'

async function until(fn, what = 'condition') {
  const deadline = Date.now() + 2000
  while (!fn()) {
    if (Date.now() > deadline) throw new Error('timeout waiting for ' + what)
    await new Promise((r) => setTimeout(r, 10))
  }
}

const QUESTION = {
  id: 'qq1',
  question: '用哪种方式部署？',
  header: '部署',
  options: [
    { label: 'Docker' },
    { label: '裸机' },
  ],
}

/** 假 DSH mux：可编程下行 socket；respond 捕获为桩。 */
function makeFakeMux() {
  const state = {
    sockets: [],
    responds: [],
    respondReceipts: [],
    respondStatus: 200,
  }
  function openSocket(_url, handlers) {
    const sock = {
      handlers,
      closed: false,
      deliver(rpcId, payload) {
        handlers.onFrame(JSON.stringify({ type: 'server-request', rpcId, method: payload.type, payload }))
      },
      close() { this.closed = true; handlers.onClose() },
    }
    state.sockets.push(sock)
    queueMicrotask(() => handlers.onOpen())
    return sock
  }
  async function respondImpl(message) {
    if (state.respondStatus !== 200) throw new Error(`respond HTTP ${state.respondStatus}`)
    state.responds.push(message)
    const receipt = { accepted: true }
    state.respondReceipts.push(receipt)
    return receipt
  }
  return { openSocket, state, respondImpl }
}

function makeBridge(mux, posts, log = () => {}) {
  const mappings = []
  const bridge = createQuestionBridge({
    origin: 'http://127.0.0.1:1',
    log,
    openSocket: mux.openSocket,
    latestThreadLookup: (sessionId) => (sessionId === 'session-fixed' ? 'thread_root_1' : null),
    recordReplyMapping: (messageId, meta) => mappings.push({ messageId, meta }),
    postToSession: async (text, sessionId, parentMessageId) => {
      posts.push({ text, sessionId, parentMessageId })
      return { messageId: 'qmsg_' + posts.length }
    },
  })
  // 覆盖真实 fetch respond 为桩
  bridge.__setRespondForTest(mux.respondImpl)
  return { bridge, mappings }
}

test('question/requested relays to session thread and reply submits answer', async () => {
  const mux = makeFakeMux()
  const posts = []
  const { bridge } = makeBridge(mux, posts)

  // ① 问题到达 → 转发到该 session 最近线程
  mux.state.sockets[0].deliver('rq_1', {
    type: 'question/requested', sessionId: 'session-fixed', questions: [QUESTION],
  })
  await until(() => posts.length === 1, 'relayed post')
  assert.equal(posts[0].parentMessageId, 'thread_root_1')
  assert.match(posts[0].text, /❓ 会话在等待你的回答【部署】/)
  assert.match(posts[0].text, /1\. Docker/)
  assert.equal(bridge.__pendingCount(), 1)

  // ② 用户在飞书回「2」→ 提交作答
  const consumed = await bridge.interceptReply({
    parentMessageId: 'qmsg_1', rootMessageId: null, messageId: 'user_reply_1', text: '2',
  })
  assert.equal(consumed, true)
  assert.equal(mux.state.responds.length, 1)
  assert.deepEqual(mux.state.responds[0], {
    rpcId: 'rq_1',
    result: {
      ok: true,
      value: { sessionId: 'session-fixed', answer: { answers: [{ id: 'qq1', selected: ['裸机'] }] } },
    },
  })

  // ③ 确认回执发到用户消息线程；pending 已清；再次拦截不命中
  assert.match(posts[1].text, /✅ 已把你的回答提交给会话：裸机/)
  assert.equal(posts[1].parentMessageId, 'user_reply_1')
  assert.equal(bridge.__pendingCount(), 0)
  const again = await bridge.interceptReply({
    parentMessageId: 'qmsg_1', rootMessageId: null, messageId: 'x', text: '1',
  })
  assert.equal(again, false)

  bridge.close()
})

test('replayed frames dedupe by rpcId; resolved cleans up and notifies non-us answers', async () => {
  const mux = makeFakeMux()
  const posts = []
  const { bridge } = makeBridge(mux, posts)

  // 重连重放：同一 rpcId 发两次只应发一次帖
  mux.state.sockets[0].deliver('rq_2', {
    type: 'question/requested', sessionId: 'session-fixed', questions: [QUESTION],
  })
  mux.state.sockets[0].deliver('rq_2', {
    type: 'question/requested', sessionId: 'session-fixed', questions: [QUESTION],
  })
  await until(() => posts.filter((p) => p.text.includes('部署')).length === 1, 'one relayed post')
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(posts.filter((p) => p.text.includes('部署')).length, 1)

  // 非我方结算 → 线程里补一条说明
  mux.state.sockets[0].deliver('srv_x', {
    type: 'question/resolved', sessionId: 'session-fixed', questionRpcId: 'rq_2', outcome: 'answered',
  })
  await until(() => posts.some((p) => p.text.includes('网页端被回答')), 'resolved note')
  assert.equal(bridge.__pendingCount(), 0)

  // 我方作答后结算 → 不再补说明
  mux.state.sockets[0].deliver('rq_3', {
    type: 'question/requested', sessionId: 'session-fixed', questions: [QUESTION],
  })
  await until(() => posts.length >= 2, 'second question post')
  const before = posts.length
  await bridge.interceptReply({
    parentMessageId: 'qmsg_' + before, rootMessageId: null, messageId: 'u3', text: '1',
  })
  mux.state.sockets[0].deliver('srv_y', {
    type: 'question/resolved', sessionId: 'session-fixed', questionRpcId: 'rq_3', outcome: 'answered',
  })
  await new Promise((r) => setTimeout(r, 30))
  assert.ok(!posts.slice(before).some((p) => p.text.includes('网页端被回答')))

  bridge.close()
})

test('multi-question batch degrades to notify-only without answer registration', async () => {
  const mux = makeFakeMux()
  const posts = []
  const { bridge } = makeBridge(mux, posts)

  mux.state.sockets[0].deliver('rq_4', {
    type: 'question/requested',
    sessionId: 'session-fixed',
    questions: [QUESTION, { ...QUESTION, id: 'qq2' }],
  })
  await until(() => posts.length === 1, 'degraded notice')
  assert.match(posts[0].text, /暂不支持在飞书作答/)
  assert.equal(posts[0].parentMessageId, null) // 不选线程
  assert.equal(bridge.__pendingCount(), 0)

  // 未登记 → 拦截不命中
  const hit = await bridge.interceptReply({
    parentMessageId: 'qmsg_1', rootMessageId: null, messageId: 'u1', text: '1',
  })
  assert.equal(hit, false)
  assert.equal(mux.state.responds.length, 0)
  bridge.close()
})

test('GUI-first race: accepted=false yields info note and consumes the pending entry', async () => {
  const mux = makeFakeMux()
  const posts = []
  const { bridge } = makeBridge(mux, posts)

  mux.state.sockets[0].deliver('rq_5', {
    type: 'question/requested', sessionId: 'session-fixed', questions: [QUESTION],
  })
  await until(() => posts.length === 1, 'relayed post')
  assert.equal(bridge.__pendingCount(), 1)

  // 网页端先答了：respond 返回 accepted=false（首次即失败，非重试）
  bridge.__setRespondForTest(async () => ({ receipt: { accepted: false, reason: 'not-pending' }, retried: false }))

  const consumed = await bridge.interceptReply({
    parentMessageId: 'qmsg_' + posts.length, rootMessageId: null, messageId: 'u5', text: '1',
  })
  assert.equal(consumed, true)
  assert.ok(posts.some((p) => p.text.includes('已在 DSH 网页端处理')))
  assert.equal(bridge.__pendingCount(), 0)

  bridge.close()
})

test('root-key hit clears pending under BOTH keys (no stale re-answer mislabel)', async () => {
  const mux = makeFakeMux()
  const posts = []
  const { bridge } = makeBridge(mux, posts)

  mux.state.sockets[0].deliver('rq_6', {
    type: 'question/requested', sessionId: 'session-fixed', questions: [QUESTION],
  })
  await until(() => posts.length === 1, 'relayed post')

  // 用户在提问线程里先回了另一条消息（parent=其他消息、root=提问消息）
  const first = await bridge.interceptReply({
    parentMessageId: 'other_msg', rootMessageId: 'qmsg_1', messageId: 'u6a', text: '2',
  })
  assert.equal(first, true)
  assert.equal(mux.state.responds.length, 1)
  assert.equal(bridge.__pendingCount(), 0, 'root 键命中也必须清干净')

  // 再直接回复提问消息：不应再次提交（否则误报「已在网页端处理」）
  const second = await bridge.interceptReply({
    parentMessageId: 'qmsg_1', rootMessageId: null, messageId: 'u6b', text: '1',
  })
  assert.equal(second, false)
  assert.equal(mux.state.responds.length, 1)

  bridge.close()
})

test('retry-after-error yielding not-pending is treated as fuzzy success, not GUI race', async () => {
  const mux = makeFakeMux()
  const posts = []
  const { bridge } = makeBridge(mux, posts)

  mux.state.sockets[0].deliver('rq_7', {
    type: 'question/requested', sessionId: 'session-fixed', questions: [QUESTION],
  })
  await until(() => posts.length === 1, 'relayed post')

  // 首次 POST 网络超时（服务端其实已受理），mux-client 重试后拿到 not-pending
  // ——桥收到的就是 {receipt:{accepted:false}, retried:true} 这一归一化形状
  bridge.__setRespondForTest(async () => ({ receipt: { accepted: false, reason: 'not-pending' }, retried: true }))

  const consumed = await bridge.interceptReply({
    parentMessageId: 'qmsg_' + posts.length, rootMessageId: null, messageId: 'u7', text: '1',
  })
  assert.equal(consumed, true)
  assert.ok(posts.some((p) => p.text.includes('回答已提交')), '应按成功口径确认而非误导')
  assert.ok(!posts.some((p) => p.text.includes('已在 DSH 网页端处理')))
  assert.equal(bridge.__pendingCount(), 0)

  bridge.close()
})
