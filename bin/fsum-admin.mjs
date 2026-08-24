#!/usr/bin/env node
/**
 * fsum-admin — dsh-feishu-integration 的飞书机器人绑定/解绑管理工具
 *
 * 用法：
 *   fsum-admin list                            列出已绑定 bot
 *   fsum-admin bind                            扫码绑定（飞书 SDK 设备授权流）
 *   fsum-admin bind --app-id X --app-secret Y [--owner ou_xxx]
 *                                              手动绑定已有自建应用凭据
 *   fsum-admin unbind --app-id X | --index N   解绑（移除配置并删除凭据）
 *   fsum-admin set-owner --app-id X --open-id ou_xxx
 *                                              补设授权用户白名单
 *   fsum-admin verify --app-id X               验证某 bot 凭据可达性
 *
 * 选项：--base-url http://127.0.0.1:3080 ；--domain feishu|lark
 *
 * 说明：
 *   - 凭据优先经 DSH loopback RPC（credentials.set/unset）写入
 *     ~/.dsh/.credentials.yaml；dsh web 未运行时回退为直接改写该文件
 *     （扁平 KEY: VALUE 格式，逐行替换，不动其他行）。
 *   - 绑定后：出站总结即时生效；入站长连接需重启 dsh web。
 *   - 解绑后：重启 dsh web 才真正断开该 bot 的长连接。
 */

import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// ────────────────────────── 基础设施 ──────────────────────────

function dshHome() {
  return process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh')
}
function configPath() {
  return join(dshHome(), 'integrations', 'dsh-feishu', 'config.json')
}
function credPath() {
  return join(dshHome(), '.credentials.yaml')
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(configPath(), 'utf8'))
  } catch {
    return { version: 2, bots: [] }
  }
}

function saveConfig(config) {
  const p = configPath()
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(config, null, 2))
  renameSync(tmp, p)
}

async function dshRpc(baseUrl, method, payload = {}, timeoutMs = 15000) {
  const rpcId = 'fsum-admin-' + randomUUID()
  const res = await fetch(new URL('/api/' + method, baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`DSH ${method}: HTTP ${res.status}`)
  const body = await res.json()
  if (body?.type !== 'server-response' || body?.rpcId !== rpcId) {
    throw new Error(`DSH ${method}: 无效响应`)
  }
  if (!body.result?.ok) throw new Error(`DSH ${method}: ${body.result?.error?.message ?? body.result?.error}`)
  return body.result.value
}

/** 直接读写 .credentials.yaml 的单行（扁平 KEY: VALUE）。 */
function readSecretDirect(ref) {
  try {
    for (const line of readFileSync(credPath(), 'utf8').split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/)
      if (m && m[1] === ref) return m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* 文件不存在 */ }
  return null
}

function writeSecretDirect(ref, value) {
  let lines = []
  try {
    lines = readFileSync(credPath(), 'utf8').split('\n')
  } catch { /* 新文件 */ }
  const replaced = (() => {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([A-Za-z_][A-Za-z0-9_]*):\s*/)
      if (m && m[1] === ref) {
        lines[i] = `${ref}: "${value}"`
        return true
      }
    }
    return false
  })()
  if (!replaced) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('')
    lines.push(`${ref}: "${value}"`)
  }
  const tmp = credPath() + '.fsum.tmp'
  writeFileSync(tmp, lines.join('\n'), { mode: 0o600 })
  renameSync(tmp, credPath())
}

function removeSecretDirect(ref) {
  let removed = false
  try {
    const lines = readFileSync(credPath(), 'utf8').split('\n')
      .filter((line) => {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*/)
        if (m && m[1] === ref) { removed = true; return false }
        return true
      })
    if (removed) {
      const tmp = credPath() + '.fsum.tmp'
      writeFileSync(tmp, lines.join('\n'), { mode: 0o600 })
      renameSync(tmp, credPath())
    }
  } catch { /* ignore */ }
  return removed
}

/**
 * 写凭据：RPC 优先（dsh web 在跑时走权威通道），失败回退直写文件。
 */
async function putSecret(baseUrl, ref, value) {
  try {
    await dshRpc(baseUrl, 'credentials.set', { ref, value })
    return 'rpc'
  } catch (err) {
    writeSecretDirect(ref, value)
    console.warn(`· （RPC 失败: ${err.message}，已直接写入 .credentials.yaml）`)
    return 'direct'
  }
}

async function deleteSecret(baseUrl, ref) {
  try {
    await dshRpc(baseUrl, 'credentials.unset', { ref })
    return 'rpc'
  } catch (err) {
    const removed = removeSecretDirect(ref)
    if (removed) console.warn(`· （RPC 失败: ${err.message}，已直接从 .credentials.yaml 移除）`)
    else console.warn(`· 凭据 ${ref} 不存在或已清理`)
    return 'direct'
  }
}

// ────────────────────────── 飞书 API ──────────────────────────

function openBase(domain) {
  return domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
}

export async function verifyFeishuApp({ appId, appSecret, domain = 'feishu', fetchImpl = fetch }) {
  if (!appId || !appSecret) throw new Error('appId/appSecret 不完整')
  const tokenRes = await fetchImpl(openBase(domain) + '/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  })
  const tokenBody = await safeJson(tokenRes, '飞书认证')
  if (!tokenBody.tenant_access_token) throw new Error('飞书认证未返回 tenant_access_token')
  const botRes = await fetchImpl(openBase(domain) + '/open-apis/bot/v3/info/', {
    headers: { authorization: `Bearer ${tokenBody.tenant_access_token}` },
  })
  const botBody = await safeJson(botRes, '读取机器人信息')
  const bot = botBody.bot ?? {}
  return {
    appId,
    botName: bot.app_name ?? bot.bot_name ?? null,
    botOpenId: bot.open_id ?? null,
    activateStatus: bot.activate_status ?? null,
  }
}

async function safeJson(res, op) {
  let body
  try { body = await res.json() } catch { throw new Error(`${op} 返回非 JSON`) }
  if (!res.ok || body?.code !== 0) throw new Error(`${op} 失败: ${body?.msg ?? 'HTTP ' + res.status}`)
  return body
}

function extractScannerOpenId(userInfo) {
  if (!userInfo || typeof userInfo !== 'object') return null
  return userInfo.open_id ?? userInfo.openId ?? userInfo.user?.open_id ?? userInfo.user_id ?? null
}

// ────────────────────────── 子命令 ──────────────────────────

export async function cmdList() {
  const bots = loadConfig().bots ?? []
  if (bots.length === 0) {
    console.log('（尚未绑定任何 bot）')
    return
  }
  bots.forEach((b, i) => {
    console.log(
      `[${i}] ${b.botName ?? '(未知名)'}  appId=${b.appId}` +
      `\n    id=${b.id}  激活=${b.activated ?? '?'}  授权用户=${(b.ownerOpenIds ?? []).join(',') || '(无!)'}` +
      `\n    secretRef=${b.secretRef}  domain=${b.domain ?? 'feishu'}${b.deletionPending ? '  [待删除]' : ''}`,
    )
  })
}

export async function startBind(opts) {
  const { baseUrl, domain = 'feishu' } = opts
  let appId, appSecret
  let scannerOpenId = opts.owner ?? null

  if (opts.appId && opts.appSecret) {
    appId = opts.appId
    appSecret = opts.appSecret
    console.log('· 使用手动提供的凭据')
  } else {
    console.log('· 正在向飞书申请设备码…')
    const Lark = await import('@larksuiteoapi/node-sdk')
    let qrPrinted = false
    const result = await Lark.registerApp({
      domain,
      source: 'dsh-feishu-integration',
      onQRCodeReady(info) {
        qrPrinted = true
        console.log('\n═══════════════════════════════════════════════')
        console.log('请用手机飞书打开以下链接完成扫码授权：')
        console.log('')
        console.log('  ' + info.url)
        console.log('')
        console.log(`（约 ${Math.round((info.expireIn ?? 600) / 60)} 分钟内有效；桌面浏览器打开亦可操作）`)
        void tryOpenBrowser(info.url)
        console.log('等待扫码确认中…\n')
      },
      onStatusChange(info) {
        if (info?.status === 'slow_down') console.log('· 飞书要求放慢轮询…')
      },
    }).catch((err) => {
      if (!qrPrinted) console.error('未能获取二维码:', err.message)
      throw err
    })
    appId = result.client_id
    appSecret = result.client_secret
    scannerOpenId = extractScannerOpenId(result.user_info) ?? scannerOpenId
    console.log('✓ 授权成功，收到应用凭据')
  }

  console.log('· 校验凭据并读取机器人身份…')
  const identity = await verifyFeishuApp({ appId, appSecret, domain })
  console.log(`✓ 机器人: ${identity.botName ?? appId}  open_id=${identity.botOpenId ?? '?'}  激活状态=${identity.activateStatus ?? '?'}`)
  if (identity.activateStatus != null && identity.activateStatus !== 1 && identity.activateStatus !== 'activated') {
    console.log('⚠️ 该应用可能尚未激活/发布，消息收发或不可用。')
  }

  const hex = randomUUID().replaceAll('-', '').toLowerCase()
  const secretRef = 'DSH_FEISHU_APP_SECRET_' + hex.toUpperCase()
  console.log('· 写入凭据存储…')
  await putSecret(baseUrl, secretRef, appSecret)

  const config = loadConfig()
  config.bots ??= []
  const now = new Date().toISOString()
  const entry = {
    id: 'bot_' + hex,
    appId,
    secretRef,
    ownerOpenIds: scannerOpenId ? [scannerOpenId] : [],
    domain,
    botName: identity.botName,
    botOpenId: identity.botOpenId,
    activated: identity.activateStatus ?? 1,
    connectedAt: now,
    createdAt: now,
  }
  const dup = config.bots.find((b) => b.appId === appId)
  if (dup) {
    Object.assign(dup, entry, { id: dup.id })
    console.log(`· 已更新现有绑定 (${dup.id})`)
  } else {
    config.bots.push(entry)
    console.log(`· 已新增绑定 (${entry.id})`)
  }
  saveConfig(config)

  const ownerNote = entry.ownerOpenIds.length === 0
    ? `\n⚠️ 未能自动识别扫码人 open_id，请运行:\n   fsum-admin set-owner --app-id ${appId} --open-id ou_你的openId\n  （否则白名单为空，任何人的消息都会被拒收）`
    : `\n✓ 授权用户: ${entry.ownerOpenIds.join(', ')}`
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 绑定完成: ${identity.botName ?? appId}
   出站总结: 即刻生效（无需重启）
   入站回复路由: 需重启 dsh web 后生效${ownerNote}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
}

export async function cmdUnbind(opts) {
  const { baseUrl, appId } = opts
  if (!appId && opts.index == null) throw new Error('需要 --app-id 或 --index')
  const config = loadConfig()
  const bots = config.bots ?? []
  const i = opts.index != null
    ? Number(opts.index)
    : bots.findIndex((b) => b.appId === appId || b.id === appId)
  if (!(i >= 0 && i < bots.length)) throw new Error('未找到该 bot')
  const [removed] = bots.splice(i, 1)
  saveConfig(config)
  console.log(`· 已从配置移除: ${removed.botName ?? removed.appId} (${removed.id})`)

  await deleteSecret(baseUrl, removed.secretRef)
  console.log('✅ 解绑完成。注意：其长连接将在下次重启 dsh web 时才真正断开；\n   历史状态文件保留于 integrations/dsh-feishu/bots/<id>/，可手动删除。')
}

export async function cmdSetOwner(opts) {
  const { appId, openId } = opts
  if (!appId || !openId) throw new Error('需要 --app-id 与 --open-id')
  const config = loadConfig()
  const bot = (config.bots ?? []).find((b) => b.appId === appId || b.id === appId)
  if (!bot) throw new Error('未找到该 bot')
  bot.ownerOpenIds = [...new Set([...(bot.ownerOpenIds ?? []), openId])]
  saveConfig(config)
  console.log(`✓ 授权用户现为: ${bot.ownerOpenIds.join(', ')}`)
}

export async function cmdVerify(opts) {
  const config = loadConfig()
  const bot = (config.bots ?? []).find((b) => b.appId === opts.appId || b.id === opts.appId)
  if (!bot) throw new Error('未找到该 bot')
  const secret = readSecretDirect(bot.secretRef)
  if (!secret) throw new Error(`凭据 ${bot.secretRef} 不存在于 .credentials.yaml`)
  const identity = await verifyFeishuApp({ appId: bot.appId, appSecret: secret, domain: bot.domain ?? 'feishu' })
  console.log(`✅ 可达: ${identity.botName ?? bot.appId}  激活=${identity.activateStatus ?? '?'}`)
}

async function tryOpenBrowser(url) {
  try {
    if (platform() === 'darwin') {
      const { spawn } = await import('node:child_process')
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
    }
  } catch { /* 忽略 */ }
}

// ────────────────────────── CLI 入口 ──────────────────────────

const HELP = `
用法: fsum-admin <命令> [选项]
命令:
  list                                        列出已绑定 bot
  bind [--app-id X --app-secret Y] [--owner ou_xxx]
                                              扫码绑定 / 手动绑定
  unbind --app-id X | --index N               解绑并删除凭据
  set-owner --app-id X --open-id ou_xxx       补设授权用户白名单
  verify --app-id X                           验证凭据可达性
选项:
  --base-url http://127.0.0.1:3080            DSH web 地址
  --domain feishau|lark                       站点域（默认 feishu）
`

function parseArgs(argv) {
  const args = {}
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next
        i++
      } else {
        args[key] = true
      }
    } else {
      rest.push(a)
    }
  }
  return { args, rest }
}

export async function main(argv) {
  const { args, rest } = parseArgs(argv)
  const command = rest[0] ?? 'help'
  const opts = {
    baseUrl: args['base-url'] ?? process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080',
    domain: args.domain === 'lark' ? 'lark' : 'feishu',
    appId: args['app-id'],
    appSecret: args['app-secret'],
    owner: args.owner ?? args['open-id'],
    openId: args['open-id'],
    index: args.index,
  }

  switch (command) {
    case 'list': return cmdList()
    case 'bind': return startBind(opts)
    case 'unbind': return cmdUnbind(opts)
    case 'set-owner': return cmdSetOwner(opts)
    case 'verify': return cmdVerify(opts)
    default:
      process.stdout.write(HELP)
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  main(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌', err?.message ?? err)
      process.exit(1)
    })
}
