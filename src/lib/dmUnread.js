export function unreadCount(messages, lastReadAt, myUserId) {
  if (!messages || messages.length === 0) return 0
  const threshold = lastReadAt ? Date.parse(lastReadAt) : 0
  let count = 0
  for (const m of messages) {
    if (m.author_id === myUserId) continue
    if (Date.parse(m.created_at) > threshold) count++
  }
  return count
}

export function totalUnread(conversations) {
  if (!conversations) return 0
  return conversations.reduce((sum, c) => sum + (c.unread || 0), 0)
}
