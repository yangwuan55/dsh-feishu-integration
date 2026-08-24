/**
 * dsh-feishu-integration — 飞书与 DeepSeek Harness 双向集成（组装根）
 *
 * 出站：任意会话 turn/end(completed) 后向飞书发送总结；发送后记录
 *   飞书 message_id → DSH sessionId 映射（reply-map.json），供回复路由使用。
 *   由飞书回复触发的回合（rpcId 前缀 fsum-）不产生新总结，防乒乓。
 *
 * 入站（takeoverInbound=true）：WSClient 长连接接收 im.message.receive_v1，
 *   parent_id/root_id 命中 reply-map → 直投对应 DSH 会话并把最终回答回帖；
 *   未命中 → p2p/group 固定会话延续。设置页 UI 走 /feishu connection RPC。
 *
 * 模块布局（本文件只做组装，不含业务细节）：
 *   lib/shared/  纯函数与常量（测试缝）
 *   lib/host/    bot 存储 / reply-map / 飞书 API / 总结推送 /
 *                session 网关 / 单 bot 入站运行时 / 设置页 RPC
 *   client-src/  浏览器设置页源码 → scripts/build-client.mjs → lib/client.js
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { createBotStore } from './host/bot-store.js'
import { createReplyMapStore } from './host/reply-map-store.js'
import { createFeishuApi } from './host/feishu-api.js'
import { installSummaryPush } from './host/summary-service.js'
import { startInboundForBot } from './host/inbound-runtime.js'
import { installConnectionRpc } from './host/connection-rpc.js'

export const name = 'dsh-feishu-integration'
export const inject = ['connection', 'credentials', 'webServer']

/** 公开纯函数测试缝（test/reply-chain.test.mjs 从这里导入）。 */
export { findReplyMapping, formatRouteAcknowledgement } from './shared/reply-routing.js'

function harnessBaseSafe(u) {
  try { return new URL(u).origin } catch { return u }
}

function requireWebServerPort(ctx) {
  const port = ctx.webServer?.port
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('dsh-feishu-integration 需要 ctx.webServer.port 或配置 harnessBaseUrl')
  }
  return port
}

export function apply(ctx, config = {}) {
  const {
    title = 'dsh 回复总结',
    maxText = 1500,
    includeReasons = ['completed'],
    openId = '',
    chatId = '',
    botSelection = 'all',
    takeoverInbound = false,        // true=启动长连接接管入站（须先禁用其他飞书长连接插件！）
    harnessBaseUrl = '',            // 缺省用 ctx.webServer.port 自动推导
    workspace = process.cwd(),      // 创建新固定会话时的工作区路径
    agentPreset = 'standard',
    replyMapMax = 500,              // reply-map LRU 上限
    replyMapTtlDays = 7,            // 映射有效期
    replyTimeoutMs = 600000,        // 等待目标会话回答的超时
    replyMaxChars = 9000,           // 单条回帖分片上限
  } = config

  const log = (level, ...args) => {
    const logger = ctx.logger ?? console
    const fn = logger[level] ?? logger.log ?? console.log
    try { fn.call(logger, '[' + name + ']', ...args) } catch { /* ignore */ }
  }

  // ── 共享基础设施 ──
  const dshHome = process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
  const feishuDir = join(dshHome, 'integrations', 'dsh-feishu')
  const replyMapPath = config.replyMapPath ?? join(feishuDir, 'reply-map.json')

  const botStore = createBotStore({ feishuDir, log })
  const replyMapStore = createReplyMapStore({ replyMapPath, replyMapMax, replyMapTtlDays, log })
  const feishuApi = createFeishuApi()

  // ── 出站：总结推送 + 记账 + 防回环 ──
  const summary = installSummaryPush(ctx, {
    title, maxText, includeReasons, botSelection, openId, chatId,
    loadBots: botStore.loadFeishuBots,
    resolveSecret: (bot) => ctx.credentials.resolve(bot.secretRef),
    sendTextMessage: feishuApi.sendTextMessage,
    recordReplyMapping: replyMapStore.record,
    log,
  })

  // ── 入站接管：长连接 + 分拣路由 ──
  const origin = harnessBaseUrl
    ? new URL(harnessBaseSafe(harnessBaseUrl))
    : new URL('http://127.0.0.1:' + requireWebServerPort(ctx))

  // 运行时注册表：botId → {botId, stop, ready, feishuLongConnectionState, lastError}
  const runtimes = new Map()
  const botErrors = new Map()

  function launchBot(bot, appSecret) {
    if (runtimes.has(bot.id)) return Promise.resolve(runtimes.get(bot.id))
    const record = {
      botId: bot.id, ready: false, feishuLongConnectionState: 'connecting',
      harnessReachable: true, lastError: null, stop: null,
    }
    runtimes.set(bot.id, record)
    return startInboundForBot({
      origin, workspace, agentPreset, replyTimeoutMs, replyMaxChars,
      bot, appSecret, record,
      helpers: {
        log,
        lookupReplyMapping: replyMapStore.lookup,
        recordReplyMapping: replyMapStore.record,
        readBotState: botStore.readBotState,
        writeBotState: botStore.writeBotState,
      },
    }).catch((err) => {
      runtimes.delete(bot.id)
      throw err
    })
  }

  function stopBot(botId) {
    const rec = runtimes.get(botId)
    if (rec?.stop) { try { rec.stop() } catch { /* ignore */ } }
    runtimes.delete(botId)
  }

  async function resolveBotSecret(bot) {
    const secret = await ctx.credentials.resolve(bot.secretRef)
    return secret?.value ?? null
  }

  async function startAllBots() {
    const targets = await summary.targetsWithCredentials()
    if (targets.length === 0) {
      log('warn', 'takeoverInbound=true 但没有可用 bot/凭据，入站未启动')
      return
    }
    for (const { bot, appSecret } of targets) {
      launchBot(bot, appSecret).catch((err) => log('warn', '入站接管启动失败:', String(err)))
    }
  }

  if (takeoverInbound) {
    void startAllBots().catch((err) => log('warn', '入站接管初始化失败:', String(err)))
  } else {
    log('info', 'takeoverInbound=false：仅出站总结模式')
  }

  // ── 设置页 UI 通道（与旧 @xmanrui/dsh-feishu 客户端契约兼容）──
  installConnectionRpc(ctx, {
    config2Dest: () => ({ chatId, openId }),
    runtimes, botErrors,
    loadFeishuBots: botStore.loadFeishuBots,
    saveBots: botStore.saveFeishuBots,
    credentials: ctx.credentials,
    registerAppFn: config.provisionRegisterApp ?? null,
    launchBot, stopBot, resolveBotSecret,
    dshHome,
  })
}
