/**
 * 入站链路顺序回归：路由解析 → 即时回执 → OnIt reaction → session.prompt
 * → 最终回复；回执发送失败不得阻断后续流程。
 *
 * 用假 Lark SDK + 本地 RPC 桩服务走真实 startInboundForBot 代码路径。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { startInboundForBot } from '../lib/host/inbound-runtime.js'

/** 假 Lark SDK：记录所有飞书写操作，暴露事件分发器给测试触发。 */
function makeFakeLark(log, { failReply = false } = {}) {
  const Domain = { Feishu: 'feishu', Lark: 'lark' }
  const LoggerLevel = { info: 'info' }
  let seq = 0

  class EventDispatcher {
    register(handlers) {
      // 直接挂到实例上，方便测试触发（真实 SDK 内部私有存储）
      Object.assign(this, handlers)
      return this
    }
  }

  class Client {
    im = {
      v1: {
        message: {
          reply: async ({ path, data }) => {
            if (failReply) throw new Error('feishu down')
            const id = 'om_reply_' + (++seq)
            log.push({ op: 'reply', to: path.message_id, text: JSON.parse(data.content).text, id })
            return { data: { message_id: id } }
          },
          create: async ({ data }) => {
            log.push({ op: 'send', text: JSON.parse(data.content).text })
            return { data: {} }
          },
        },
        messageReaction: {
          create: async ({ path, data }) => {
            log.push({ op: 'reaction', kind: 'add', emoji: data.reaction_type.emoji_type, to: path.message_id })
            return { data: { reaction_id: 'r_' + path.message_id } }
          },
          delete: async () => ({}),
        },
      },
    }
  }

  class WSClient {
    async start({ eventDispatcher }) {
      this.eventDispatcher = eventDispatcher
      log.push('ws-start')
    }
    close() { log.push('ws-close') }
  }

  return {
    Domain, LoggerLevel, EventDispatcher, WSClient, Client,
    /** 测试取回 dispatcher：start 后由包装的 WSClient 填充。 */
    __dispatchers: [],
  }
}

function makeFakeLarkWithCapture(log, opts) {
  const sdk = makeFakeLark(log, opts)
  const origStart = sdk.WSClient.prototype.start
  sdk.WSClient.prototype.start = async function (opts2) {
    sdk.__dispatchers.push(opts2.eventDispatcher)
    return origStart.call(this, opts2)
  }
  return sdk
}

/** 最小 DSH RPC 桩：session.list / session.history / session.prompt。 */
function listen(server) {
  return new Promise((resolve) => server.once('listening', resolve))
}

function makeRpcServer(state) {
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const { rpcId, method, payload } = JSON.parse(body)
      const ok = (value) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } }))
      }
      if (method === 'session.list') {
        return ok({ items: [{ sessionId: 'session-fixed', cwd: '/tmp/proj-w', projections: { values: { title: '测试会话' } } }] })
      }
      if (method === 'session.history') {
        return ok({ events: state.prompted ? structuredClone(state.historyEvents) : [] })
      }
      if (method === 'session.prompt') {
        state.prompted = true
        state.promptRpcId = rpcId // 请求体顶层的 rpcId
        state.promptText = payload.content?.[0]?.text
        return ok({})
      }
      res.statusCode = 200
      res.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: false, error: { code: 'unknown-method', message: method } } }))
    })
  })
  return server
}

function makeEvent(text) {
  return {
    sender: { sender_type: 'user', sender_id: { open_id: 'ou_u1' } },
    message: {
      message_id: 'om_in_1',
      message_type: 'text',
      chat_type: 'p2p',
      chat_id: 'oc_chat1',
      content: JSON.stringify({ text }),
    },
  }
}

async function closeServer(server) {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
}

async function until(fn, label, ms = 5000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (fn()) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error('timeout waiting for: ' + label)
}

function makeHelpers(mappings) {
  return {
    log: () => {},
    lookupReplyMapping: () => null,
    recordReplyMapping: (messageId, meta) => mappings.push({ messageId, ...meta }),
    readBotState: () => ({ version: 1, sessions: { 'p2p:ou_u1': 'session-fixed' }, seenMessageIds: [] }),
    writeBotState: () => {},
  }
}

const BOT = { id: 'bot_x', appId: 'cli_a', secretRef: 'ref', botName: '测试机器人' }

test('inbound flow acknowledges routing before prompting and replies after turn end', async () => {
  const log = []
  const mappings = []
  const state = { prompted: false, promptRpcId: null, promptText: null, historyEvents: [] }

  const server = makeRpcServer(state)
  await listen(server.listen(0, '127.0.0.1'))
  const origin = `http://127.0.0.1:${server.address().port}`

  const larkSdk = makeFakeLarkWithCapture(log)
  await startInboundForBot({
    origin,
    workspace: '/tmp/proj-w',
    agentPreset: 'standard',
    replyTimeoutMs: 4000,
    replyMaxChars: 9000,
    bot: BOT,
    appSecret: 's3cret',
    record: null,
    larkSdk,
    helpers: makeHelpers(mappings),
  })

  const dispatcher = larkSdk.__dispatchers[0]
  assert.ok(dispatcher, 'dispatcher captured')

  // 触发入站事件（accept 同步调度，handle 异步执行）
  dispatcher['im.message.receive_v1'](makeEvent('帮我看看'))

  // 1. 即时回执先于其他飞书写操作
  await until(() => log.some((e) => e?.op === 'reply'), 'ack reply')
  const ack = log.find((e) => e?.op === 'reply')
  assert.match(ack.text, /已转发到对应 DSH 会话/)
  assert.match(ack.text, /空间：\/tmp\/proj-w/)
  assert.match(ack.text, /会话：测试会话（session-fixed）/)

  // 2. OnIt reaction 在回执之后、prompt 之前
  await until(() => state.prompted, 'prompt issued')
  const ackIdx = log.indexOf(ack)
  const onItIdx = log.findIndex((e) => e?.op === 'reaction' && e.emoji === 'OnIt')
  assert.ok(onItIdx > ackIdx, 'OnIt reaction comes after the acknowledgement')

  // 3. prompt 注入的是用户文本，rpcId 带 fsum- 前缀（防回环依据）
  assert.equal(state.promptText, '帮我看看')
  assert.match(state.promptRpcId, /^fsum-/)

  // 4. 会话产生回答后：DONE reaction + 最终回复到同一线程
  state.historyEvents = [
    { event: { seq: 10, type: 'turn/start', data: { turn: 7 } } },
    { event: { seq: 11, type: 'user/message', data: { source: { rpcId: state.promptRpcId }, turn: 7 } } },
    { event: { seq: 12, type: 'assistant/message', data: { turn: 7, message: { content: [{ type: 'text', text: '最终回答' }] } } } },
    { event: { seq: 13, type: 'turn/end', data: { turn: 7 } } },
  ]
  await until(() => log.filter((e) => e?.op === 'reply').length >= 2, 'final reply')
  const final = log.filter((e) => e?.op === 'reply')[1]
  assert.equal(final.to, 'om_in_1')
  assert.equal(final.text, '最终回答')
  assert.ok(log.some((e) => e?.op === 'reaction' && e.emoji === 'DONE'), 'DONE reaction added')

  // 5. 入站消息与两条回帖都映射到同一 session（连续线程路由依据）
  const mappedIds = new Set(mappings.map((m) => m.messageId))
  for (const id of ['om_in_1', ack.id, final.id]) {
    assert.ok(mappedIds.has(id), `mapping recorded for ${id}`)
  }
  assert.ok(mappings.every((m) => m.sessionId === 'session-fixed'))

  await closeServer(server)
})

test('acknowledgement failure does not block reaction or prompt flow', async () => {
  const log = []
  const state = { prompted: false, promptRpcId: null, promptText: null, historyEvents: [] }
  const larkSdk = makeFakeLarkWithCapture(log, { failReply: true })

  const server = makeRpcServer(state)
  await listen(server.listen(0, '127.0.0.1'))
  const origin = `http://127.0.0.1:${server.address().port}`

  await startInboundForBot({
    origin,
    workspace: '/tmp/proj-w',
    agentPreset: 'standard',
    replyTimeoutMs: 1200,
    replyMaxChars: 9000,
    bot: BOT,
    appSecret: 's3cret',
    record: null,
    larkSdk,
    helpers: makeHelpers([]),
  })

  const dispatcher = larkSdk.__dispatchers[0]
  dispatcher['im.message.receive_v1'](makeEvent('帮我看看'))

  // 回执失败后仍应继续：OnIt reaction 与 prompt 都发生
  await until(() => state.prompted, 'prompt despite ack failure')
  assert.ok(
    log.some((e) => e?.op === 'reaction' && e.emoji === 'OnIt'),
    'OnIt reaction still added after ack failure',
  )
  assert.equal(state.promptText, '帮我看看')

  await closeServer(server)
})

test('ask timeout stays silent in Feishu — the routing ack already served as the reply', async () => {
  const log = []
  const state = { prompted: false, promptRpcId: null, promptText: null, historyEvents: [] }
  const larkSdk = makeFakeLarkWithCapture(log)

  // 历史永远不产生 turn/end → ask() 必然超时
  const server = makeRpcServer(state)
  await listen(server.listen(0, '127.0.0.1'))
  const origin = `http://127.0.0.1:${server.address().port}`

  await startInboundForBot({
    origin,
    workspace: '/tmp/proj-w',
    agentPreset: 'standard',
    replyTimeoutMs: 600,
    replyMaxChars: 9000,
    bot: BOT,
    appSecret: 's3cret',
    record: null,
    larkSdk,
    helpers: makeHelpers([]),
  })

  const dispatcher = larkSdk.__dispatchers[0]
  dispatcher['im.message.receive_v1'](makeEvent('帮我看看'))

  await until(() => state.prompted, 'prompt issued')
  // 等待 ask() 轮询超时并走完 handle() 的 catch（600ms 超时 + 轮询间隔余量）
  await new Promise((r) => setTimeout(r, 1800))

  // 飞书侧只有一条回帖：路由回执本身；没有任何失败反馈
  const replies = log.filter((e) => e?.op === 'reply')
  assert.equal(replies.length, 1, 'only the routing acknowledgement is posted')
  assert.match(replies[0].text, /已转发到对应 DSH 会话/)
  assert.ok(
    !log.some((e) => e?.op === 'reaction' && e.emoji === 'ERROR'),
    'no ERROR reaction on timeout',
  )
  assert.ok(
    log.some((e) => e?.op === 'reaction' && e.emoji === 'OnIt'),
    'OnIt reaction kept as-is',
  )

  await closeServer(server)
})
