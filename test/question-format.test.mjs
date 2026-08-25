import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatQuestionText, parseAnswerChoice, formatAnswerConfirmation } from '../lib/shared/question-format.js'

const QUESTION = {
  id: 'q1',
  question: '用哪种方式部署？',
  header: '部署',
  detail: '两个方案都可以，请选择',
  options: [
    { label: 'Docker', description: '容器化' },
    { label: '裸机', description: '直接跑' },
  ],
}

test('formatQuestionText renders single question with numbered options', () => {
  const text = formatQuestionText([QUESTION])
  assert.match(text, /❓ 会话在等待你的回答【部署】/)
  assert.match(text, /用哪种方式部署？/)
  assert.match(text, /1\. Docker —— 容器化/)
  assert.match(text, /2\. 裸机 —— 直接跑/)
  assert.match(text, /回复编号选择/)
})

test('formatQuestionText returns null for multi-question batch', () => {
  const two = [{ ...QUESTION, id: 'a' }, { ...QUESTION, id: 'b' }]
  assert.equal(formatQuestionText(two), null)
  assert.equal(formatQuestionText([]), null)
})

test('parseAnswerChoice: numeric selection', () => {
  assert.deepEqual(parseAnswerChoice('2', QUESTION), { ok: true, selected: ['裸机'] })
  assert.deepEqual(parseAnswerChoice(' 1 ', QUESTION), { ok: true, selected: ['Docker'] })
})

test('parseAnswerChoice: out-of-range and multi-on-single rejected', () => {
  assert.equal(parseAnswerChoice('9', QUESTION).ok, false)
  assert.equal(parseAnswerChoice('0', QUESTION).ok, false)
  const r = parseAnswerChoice('1、2', QUESTION)
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'single-select-multiple')
})

test('parseAnswerChoice: exact option label matches', () => {
  assert.deepEqual(parseAnswerChoice('Docker', QUESTION), { ok: true, selected: ['Docker'] })
  assert.deepEqual(parseAnswerChoice('docker', QUESTION), { ok: true, selected: ['Docker'] })
})

test('parseAnswerChoice: free text becomes custom answer', () => {
  assert.deepEqual(parseAnswerChoice('先用 Docker 跑起来再说', QUESTION), {
    ok: true, selected: [], custom: '先用 Docker 跑起来再说',
  })
})

test('parseAnswerChoice: multiSelect accepts combined numbers deduped', () => {
  const q = { ...QUESTION, multiSelect: true }
  const r = parseAnswerChoice('1、3', q) // 3 越界 → 拒绝
  assert.equal(r.ok, false)
  const ok = parseAnswerChoice('1、2', q)
  assert.deepEqual(ok.selected, ['Docker', '裸机'])
  const dup = parseAnswerChoice('1 1', q)
  assert.deepEqual(dup.selected, ['Docker'])
})

test('parseAnswerChoice: no options means custom only', () => {
  const r = parseAnswerChoice('随便写点', { id: 'q', question: '补充说明？' })
  assert.deepEqual(r, { ok: true, selected: [], custom: '随便写点' })
  assert.equal(parseAnswerChoice('', QUESTION).ok, false)
})

test('formatAnswerConfirmation summarizes choice or custom', () => {
  assert.equal(
    formatAnswerConfirmation(QUESTION, { selected: ['Docker'] }),
    '✅ 已把你的回答提交给会话：Docker',
  )
  assert.match(
    formatAnswerConfirmation(QUESTION, { selected: [], custom: 'x'.repeat(50) }),
    /…$/,
  )
})
