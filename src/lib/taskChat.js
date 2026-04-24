// src/lib/taskChat.js

export function isTaskChatActive(conv) {
  if (!conv || conv.kind !== 'task') return false
  return conv.task_status !== 'Done'
}

export function sortTaskChatRows(rows) {
  if (!Array.isArray(rows)) return []
  return [...rows].sort((a, b) => {
    const aTs = a?.last_message_at || a?.task_last_updated || ''
    const bTs = b?.last_message_at || b?.task_last_updated || ''
    // Both null/empty → 0; otherwise newer first.
    if (!aTs && !bTs) return 0
    if (!aTs) return 1
    if (!bTs) return -1
    return bTs.localeCompare(aTs)
  })
}

export function deriveUnreadCount({ raw_unread, last_read_at, last_message_at }) {
  if (raw_unread == null) return 0
  if (last_read_at && last_message_at && last_read_at >= last_message_at) return 0
  return raw_unread
}
