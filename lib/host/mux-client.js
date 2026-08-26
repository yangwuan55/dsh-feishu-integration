/**
 * DSH mux 客户端：消费本机 /api/events.mux 事件流 + 提交 /api/respond 作答。
 *
 * 协议事实（源码核验 @deepseek-ai/dsh-client-connection@0.1.1-rc.2）：
 * - 运行版本对 GET /api/events.mux 返回 426，HTTP SSE 载体被禁用；
 *   唯一载体是 WebSocket 升级（纯下行：客户端发任何消息会被 1008 关闭）；
 * - 下行文本帧：{type:'server-request', rpcId, method: payload.type, payload}；
 *   连接建立时服务端重放全部未决提问/审批；
 * - 作答仍走 HTTP：POST /api/respond 体 {rpcId, result:{ok,value}} → {accepted, reason?}。
 *
 * 传输通过 openSocket 注入以便测试；语义解析在 question-bridge。
 */

const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 30000

/** 默认传输：globalThis.WebSocket（Node ≥21 内置）。 */
function defaultOpenSocket(url, handlers) {
  const WS = globalThis.WebSocket
  if (typeof WS !== 'function') throw new Error('运行环境缺少 WebSocket（需要 Node ≥21）')
  const ws = new WS(url)
  ws.addEventListener('open', () => handlers.onOpen())
  ws.addEventListener('message', (ev) => {
    if (typeof ev.data === 'string') handlers.onFrame(ev.data)
  })
  ws.addEventListener('close', () => handlers.onClose())
  ws.addEventListener('error', () => handlers.onError(new Error('websocket error')))
  return { close: () => { try { ws.close() } catch { /* ignore */ } } }
}

export function createMuxClient({ origin, onFrame, log, openSocket = defaultOpenSocket }) {
  let closed = false
  let attempt = 0
  let current = null

  function handleEnvelope(data) {
    let envelope
    try {
      envelope = JSON.parse(data)
    } catch {
      log?.('warn', 'mux 帧不是合法 JSON，已跳过')
      return
    }
    if (envelope?.type !== 'server-request' || typeof envelope.rpcId !== 'string') return
    try {
      onFrame({ rpcId: envelope.rpcId, payload: envelope.payload })
    } catch (err) {
      log?.('warn', 'mux 帧处理异常:', String(err))
    }
  }

  async function connectLoop() {
    const url = new URL('/api/events.mux', origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    while (!closed) {
      await new Promise((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          resolve()
        }
        let sock = null
        try {
          sock = openSocket(url, {
            onOpen: () => {
              attempt = 0
              log?.('info', 'DSH mux 事件流已连接 (WebSocket)')
            },
            onFrame: handleEnvelope,
            onClose: () => finish(),
            onError: () => { /* close 随后到达，由 onClose 收尾 */ },
          })
        } catch (err) {
          log?.('warn', 'mux 连接创建失败:', String(err))
          finish()
          return
        }
        current = sock
      })
      current = null
      if (closed) break
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt)
      attempt += 1
      log?.('warn', `mux 连接断开，${Math.round(delay / 1000)}s 后重连`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }

  /**
   * 提交作答/取消。返回 { receipt, retried }：
   * retried=true 表示首次传输失败后重试才拿到响应——此时 receipt 若为
   * accepted:false，更可能是首次已被服务端受理（响应丢失），调用方应按
   * 模糊成功处理而非「已在别处处理」。
   */
  async function respond(message) {
    let lastErr = null
    for (let i = 0; i < 2; i++) {
      const isRetry = i > 0
      try {
        const res = await fetch(new URL('/api/respond', origin), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // 服务端 clientResponseSchema 要求完整信封：缺 type 会被判
          // bad-response 直接拒收（曾导致所有飞书作答静默失败）
          body: JSON.stringify({ type: 'client-response', ...message }),
          signal: AbortSignal.timeout(10000),
        })
        if (!res.ok) throw new Error(`respond HTTP ${res.status}`)
        return { receipt: await res.json(), retried: isRetry }
      } catch (err) {
        lastErr = err
      }
    }
    throw lastErr
  }

  function close() {
    closed = true
    try { current?.close() } catch { /* ignore */ }
  }

  const done = connectLoop().catch((err) => {
    if (!closed) log?.('warn', 'mux 客户端退出:', String(err))
  })

  return { respond, close, done }
}
