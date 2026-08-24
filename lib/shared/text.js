/** 纯文本工具：无副作用，host 侧各模块共用。 */

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

/** 取某回合最后一条 assistant 消息的纯文本。 */
export function lastAssistantText(session, turn) {
  for (const e of [...session.events].reverse()) {
    if (e.type === 'assistant/message' && e.data?.turn === turn) {
      return (e.data.message?.content ?? [])
        .filter((b) => b.type === 'text').map((b) => b.text).join('')
    }
  }
  return ''
}

export function extractText(event) {
  if (event?.message?.message_type !== 'text') return null
  let parsed
  try { parsed = JSON.parse(event.message.content) } catch { return null }
  let text = typeof parsed.text === 'string' ? parsed.text : ''
  for (const mention of event.message.mentions ?? []) {
    if (typeof mention.key === 'string' && mention.key) text = text.replaceAll(mention.key, '')
  }
  return text.trim() || null
}

export function splitText(text, maxChars = 9000) {
  const t = String(text ?? '')
  if (t.length <= maxChars) return [t]
  const chunks = []
  let rest = t
  while (rest.length > maxChars) {
    let at = rest.lastIndexOf('\n', maxChars)
    if (at < Math.floor(maxChars * 0.6)) at = maxChars
    chunks.push(rest.slice(0, at))
    rest = rest.slice(at).replace(/^\n+/, '')
  }
  if (rest) chunks.push(rest)
  return chunks
}

export function clip(text, max) {
  return String(text).length > max ? String(text).slice(0, max) + '\n…' : String(text)
}
