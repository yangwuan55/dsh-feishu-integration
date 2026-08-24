/**
 * 回复路由纯函数：parent_id/root_id → 映射会话；路由回执文案。
 * 这些函数是公开测试缝（test/reply-chain.test.mjs 直接导入）。
 */

/** Resolve a Feishu thread message to the mapped DSH session. */
export function findReplyMapping(message, lookup) {
  if (typeof lookup !== 'function') return null
  const parentId = message?.parent_id
  const rootId = message?.root_id
  return (parentId ? lookup(parentId) : null)
    ?? (rootId && rootId !== parentId ? lookup(rootId) : null)
    ?? null
}

/** Format the immediate Feishu acknowledgement after routing to a DSH session. */
export function formatRouteAcknowledgement({ workspacePath, sessionTitle, sessionId } = {}) {
  const space = workspacePath || '未知空间'
  const title = sessionTitle || '未命名会话'
  const id = sessionId || '未知 session'
  return `✅ 已转发到对应 DSH 会话。\n空间：${space}\n会话：${title}（${id}）`
}
