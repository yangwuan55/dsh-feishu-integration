/**
 * 有界重试发送器测试：退避曲线、门控不消耗尝试次数、放弃与成功路径。
 * 全部注入 sleep/isReachable，无真实等待。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createResilientSender, computeBackoffMs } from '../lib/host/resilient-send.js'

function makeHarness({ reachableSequence = null, failTimes = 0, maxAttempts = 10 } = {}) {
  const events = { sends: 0, sleeps: [], logs: [] }
  let failuresLeft = failTimes
  let probe = Array.isArray(reachableSequence) ? reachableSequence.values() : null
  const sender = createResilientSender({
    log: (...a) => events.logs.push(a.join(' ')),
    isReachable: async () => {
      if (!probe) return true
      const { value, done } = probe.next()
      return done ? true : value
    },
    sleep: async (ms) => { events.sleeps.push(ms) },
    maxAttempts,
    baseDelayMs: 100,
    maxDelayMs: 400,
    totalDeadlineMs: 60_000,
  })
  const fn = async () => {
    events.sends += 1
    if (failuresLeft > 0) { failuresLeft -= 1; throw new Error('boom ' + events.sends) }
    return 'sent#' + events.sends
  }
  return { sender, fn, events }
}

test('succeeds after transient failures and records exponential backoff', async () => {
  const { sender, fn, events } = makeHarness({ failTimes: 2 })
  const res = await sender.sendWithRetry(fn, 't')
  assert.equal(res.ok, true)
  assert.equal(res.value, 'sent#3')
  assert.equal(events.sends, 3)
  assert.equal(events.sleeps.length, 2)
  // 退避递增且封顶（base=100 cap=400，抖动 ±20%）
  for (const ms of events.sleeps) {
    assert.ok(ms >= 80 && ms <= 480, `backoff ${ms} in jitter range`)
  }
})

test('gives up after maxAttempts and reports the last error', async () => {
  const { sender, fn, events } = makeHarness({ failTimes: 999, maxAttempts: 4 })
  const res = await sender.sendWithRetry(fn, 't')
  assert.equal(res.ok, false)
  assert.match(String(res.error?.message ?? res.error), /boom 4/)
  assert.equal(events.sends, 4)
  assert.equal(events.sleeps.length, 3)
})

test('unreachable network gates retries without consuming attempts', async () => {
  // 探测序列：第1次发送后 → false,false,true（第三次探测才恢复）
  const { sender, fn, events } = makeHarness({
    reachableSequence: [false, false, true],
    failTimes: 1,
  })
  const res = await sender.sendWithRetry(fn, 't')
  assert.equal(res.ok, true)
  assert.equal(events.sends, 2, '网络恢复前不应消耗第二次真实尝试')
  // 门控期间的探测轮询 sleep（probeEveryMs 默认 2000）也应出现在等待记录里
  assert.ok(events.sleeps.length >= 2)
})

test('computeBackoffMs grows exponentially then caps', () => {
  const seq = [1, 2, 3, 4, 5, 6].map((n) => computeBackoffMs(n, 1000, 30000))
  assert.ok(seq[0] <= 1200 && seq[0] >= 800)
  assert.ok(seq[5] <= 36000 && seq[5] >= 24000, `capped around 30s±jitter, got ${seq[5]}`)
  // 单调性允许抖动重叠，但整体量级应上升：中位数比较
  assert.ok(seq[4] > seq[0])
})
