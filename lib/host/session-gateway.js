/**
 * DSH session 网关：HTTP RPC 通路 + 会话存在性 + 路由信息 + 默认会话创建
 * + prompt 注入并轮询最终回答（ask）。
 */

import { randomUUID } from 'node:crypto'
import { PROMPT_RPC_PREFIX } from '../shared/constants.js'
import { sleep } from '../shared/text.js'

/** 纯函数：从 session.list 条目解析路由回执所需的 workspace/title。 */
export function pickRouteInfo(items, sessionId, fallbackWorkspace) {
  const item = (items ?? []).find((candidate) => candidate.sessionId === sessionId)
  return {
    workspacePath: item?.cwd || fallbackWorkspace,
    sessionTitle: item?.projections?.values?.title || '未命名会话',
  }
}

export function createSessionGateway({ origin, workspace, agentPreset, replyTimeoutMs, log }) {

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
      return pickRouteInfo(items, sessionId, workspace)
    } catch (err) {
      log('warn', '读取会话路由信息失败，使用配置空间:', String(err))
      return { workspacePath: workspace, sessionTitle: '未命名会话' }
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
    if (!finished) {
      const err = new Error(`等待会话回复超时(${Math.round(replyTimeoutMs / 1000)}s)`)
      err.code = 'ask-timeout'
      throw err
    }
    return latestText.trim()
  }

  return { rpc, sessionExistsSafe, sessionRouteInfo, createFixedSession, ask }
}
