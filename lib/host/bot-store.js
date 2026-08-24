/**
 * bot 配置与 per-bot 状态文件读写（config.json + bots/<id>/state.json）。
 * 兼容旧 @xmanrui/dsh-feishu 数据布局。
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function createBotStore({ feishuDir, log }) {

  function loadFeishuBots() {
    try {
      const parsed = JSON.parse(readFileSync(join(feishuDir, 'config.json'), 'utf8'))
      return (parsed.bots ?? []).filter((b) => b && !b.deletionPending)
    } catch {
      return []
    }
  }

  /** 覆写 config.json 的 bots 列表（保留其余字段与 version）。 */
  function saveFeishuBots(bots) {
    try {
      mkdirSync(join(feishuDir, '..'), { recursive: true })
      const p = join(feishuDir, 'config.json')
      const cur = (() => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return {} } })()
      const tmp = p + '.tmp'
      writeFileSync(tmp, JSON.stringify({ ...cur, version: cur.version ?? 2, bots }, null, 2))
      renameSync(tmp, p)
    } catch (err) { log('warn', '写 feishu config 失败:', String(err)) }
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

  return { loadFeishuBots, saveFeishuBots, readBotState, writeBotState }
}
