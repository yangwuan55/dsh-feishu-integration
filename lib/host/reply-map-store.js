/**
 * reply-map 持久化：飞书 message_id → { sessionId, turn, ts, source? }。
 * LRU（按 ts 淘汰）+ TTL；读写失败不影响主流程。
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function createReplyMapStore({ replyMapPath, replyMapMax, replyMapTtlDays, log }) {
  let cache = null

  function loadReplyMap() {
    if (cache) return cache
    try {
      cache = JSON.parse(readFileSync(replyMapPath, 'utf8'))
      if (!cache.entries) throw new Error('bad shape')
    } catch {
      cache = { version: 1, entries: {} }
    }
    return cache
  }

  function saveReplyMap() {
    try {
      mkdirSync(join(replyMapPath, '..'), { recursive: true })
      const tmp = replyMapPath + '.tmp'
      writeFileSync(tmp, JSON.stringify(cache, null, 2))
      renameSync(tmp, replyMapPath)
    } catch (err) {
      log('warn', '写 reply-map 失败:', String(err))
    }
  }

  function record(messageId, meta) {
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

  function lookup(messageId) {
    if (!messageId) return null
    const hit = loadReplyMap().entries[messageId]
    if (!hit) return null
    if (Date.now() - (hit.ts ?? 0) > replyMapTtlDays * 24 * 3600 * 1000) return null
    return hit
  }

  /** 反查：该 session 最近一次出现在飞书的 message_id（提问桥选线程用）。 */
  function findLatestThreadFor(sessionId) {
    const map = loadReplyMap()
    let best = null
    for (const [messageId, meta] of Object.entries(map.entries)) {
      if (meta?.sessionId !== sessionId) continue
      if (!best || (meta.ts ?? 0) > (best.ts ?? 0)) best = { messageId, ts: meta.ts ?? 0 }
    }
    return best?.messageId ?? null
  }

  return { record, lookup, findLatestThreadFor }
}
