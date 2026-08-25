/**
 * client-src 完整性回归：index.js 调用的 api.js 导出必须全部出现在 import 列表。
 *
 * 锁定 bug：从旧单文件 bundle 拆分模块时，normalizePollResult 在 index.js
 * 中被调用却没加进 import —— node --check 与导出面冒烟都照不到这种渲染期
 * ReferenceError，直到用户真正走到 provision.poll 才爆出来。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientSrc = join(here, '..', 'client-src')

function extractImportedFromApi(indexSrc) {
  const m = indexSrc.match(/import\s*\{([^}]+)\}\s*from\s*'\.\/api\.js'/)
  assert.ok(m, 'index.js must import from ./api.js')
  return new Set(m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean))
}

function extractApiExports(apiSrc) {
  return new Set(
    [...apiSrc.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  )
}

test('every api.js export called in index.js is imported (no render-time ReferenceError)', () => {
  const indexSrc = readFileSync(join(clientSrc, 'index.js'), 'utf8')
  const apiSrc = readFileSync(join(clientSrc, 'api.js'), 'utf8')

  const imported = extractImportedFromApi(indexSrc)
  const exported = extractApiExports(apiSrc)

  // index.js 中所有裸标识符调用（排除成员访问 x.y() 与局部定义）
  const calls = new Set(
    [...indexSrc.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]),
  )
  const missing = [...calls].filter((c) =>
    exported.has(c)
    && !imported.has(c)
    && !new RegExp(`(?:function|const|class)\\s+${c}\\b`).test(indexSrc),
  )
  assert.deepEqual(missing, [], `missing imports from ./api.js: ${missing.join(', ')}`)
})

test('normalizePollResult is importable and normalizes a poll payload', async () => {
  const api = await import(join(clientSrc, 'api.js'))
  assert.equal(typeof api.normalizePollResult, 'function')
  const out = api.normalizePollResult({ status: 'pending', botId: null })
  assert.equal(out.status, 'pending')
  const conn = api.normalizePollResult({ status: 'connected', connection: { botId: 'b1' } })
  assert.equal(conn.botId, undefined) // connected 但无 botId 字段时保持可选语义
  assert.throws(() => api.normalizePollResult({}), /未知的创建状态/)
})
