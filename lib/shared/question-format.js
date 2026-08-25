/**
 * 提问桥纯函数：问题格式化 + 飞书回复文本 → 结构化作答。
 * 无副作用、无 IO，是 question-bridge 的测试缝。
 */

/**
 * 把单个提问渲染成飞书文本。
 *
 * 单问题批次（total<=1）保持既有版式；多问题批次走逐题模式：
 * 第一轮带总览提示，后续轮次带「第 k/N 题」标头。
 */
export function formatQuestionText(questions, batch) {
  if (!Array.isArray(questions) || questions.length === 0) return null
  if (questions.length > 1) return null
  const q = questions[0]
  const { index = 1, total = 1 } = batch ?? {}
  const lines = []

  if (total > 1 && index === 1) {
    lines.push(`❓ 会话在等待你的回答（共 ${total} 个问题，将逐题询问；回复「取消」可放弃）`)
    lines.push(`【第 1/${total} 题】`)
  } else if (total > 1) {
    lines.push(`【第 ${index}/${total} 题】`)
  } else {
    lines.push(`❓ 会话在等待你的回答${q.header ? `【${q.header}】` : ''}`)
  }

  lines.push(`${q.header && total > 1 ? `【${q.header}】` : ''}${q.question ?? ''}`)
  if (q.detail) {
    lines.push('')
    lines.push(q.detail)
  }
  const options = q.options ?? []
  if (options.length > 0) {
    lines.push('')
    options.forEach((opt, i) => {
      lines.push(`${i + 1}. ${opt.label}${opt.description ? ` —— ${opt.description}` : ''}`)
    })
    if (q.multiSelect === true) lines.push('可回复多个编号（如「1、3」），或直接输入自定义回答')
    else lines.push('回复编号选择，或直接输入自定义回答')
  } else {
    lines.push('')
    lines.push('直接回复文字作为你的回答')
  }
  return lines.filter((l) => l !== '').join('\n')
}

const CANCEL_WORDS = new Set(['取消', 'cancel', '放弃'])

/** 是否为整批取消指令。 */
export function isCancelCommand(text) {
  return CANCEL_WORDS.has(String(text ?? '').trim().toLowerCase())
}

/**
 * 把用户在飞书的回复文本解析成结构化作答。
 * 返回 {ok:true, selected, custom?} 或 {ok:false, reason}。
 *
 * 规则（与 DSH matchesQuestions 对齐）：
 * - 编号从 1 开始；multiSelect 允许「1、3」「1 3」「1,3」组合；
 * - 文本精确等于某选项 label 时按选择处理；
 * - 其余文本作为 custom 自定义回答；
 * - 无选项的问题一律 custom。
 */
export function parseAnswerChoice(text, question) {
  const raw = String(text ?? '').trim()
  if (raw === '') return { ok: false, reason: 'empty' }
  const options = question?.options ?? []
  const labels = options.map((o) => o.label)
  const multi = question?.multiSelect === true

  const tokens = raw.split(/[,,、\s]+/).filter(Boolean)
  const allNumeric = tokens.length > 0 && tokens.every((t) => /^\d+$/.test(t))
  if (allNumeric) {
    const nums = tokens.map((t) => Number(t))
    if (!multi && nums.length > 1) return { ok: false, reason: 'single-select-multiple' }
    for (const n of nums) {
      if (!Number.isInteger(n) || n < 1 || n > options.length) {
        return { ok: false, reason: 'out-of-range' }
      }
    }
    return { ok: true, selected: [...new Set(nums)].map((n) => labels[n - 1]) }
  }

  const lower = raw.toLowerCase()
  const exact = labels.find((l) => l.toLowerCase() === lower)
  if (exact !== undefined) return { ok: true, selected: [exact] }

  // 自定义回答：与 selected 互斥（单选）；多选允许组合但飞书侧简化为 custom 单独提交
  return { ok: true, selected: [], custom: raw }
}

/** 单题确认文案（提交成功后的小回执）。 */
export function formatAnswerConfirmation(question, parsed) {
  if (parsed.custom !== undefined) {
    const brief = parsed.custom.length > 40 ? parsed.custom.slice(0, 40) + '…' : parsed.custom
    return `✅ 已把你的回答提交给会话：${brief}`
  }
  return `✅ 已把你的回答提交给会话：${parsed.selected.join('、')}`
}

/** 整批确认文案：逐题回显「问题摘要 → 回答」。 */
export function formatBatchConfirmation(entries) {
  const rows = entries.map(({ question, parsed }) => {
    const label = String(question?.question ?? '').length > 20
      ? String(question.question).slice(0, 20) + '…'
      : String(question?.question ?? '')
    const answer = parsed.custom !== undefined
      ? (parsed.custom.length > 30 ? parsed.custom.slice(0, 30) + '…' : parsed.custom)
      : parsed.selected.join('、')
    return `${label} → ${answer}`
  })
  return ['✅ 已把全部回答提交给会话：', ...rows].join('\n')
}
