// For a group conversation, compute which participants have read up to
// which message. The result places each reader at the latest message they've
// read — exactly how Messenger stacks its seen-by avatars.
//
// Inputs:
//   messages: [{ id, created_at, author_id, kind }]   (sorted oldest → newest)
//   readers : [{ user_id, last_read_at, profile }]    (excluding the current user)
//   myId    : uuid of the current user — messages authored by a reader are
//             skipped for their own avatar (you don't need to mark yourself
//             as having read your own message).
// Returns:
//   Map<messageId, Array<reader>>  (ordered by reader arrival)

export function computeSeenByMessage(messages, readers, myId) {
  const out = new Map()
  if (!Array.isArray(messages) || messages.length === 0) return out
  if (!Array.isArray(readers) || readers.length === 0) return out

  // Walk messages oldest → newest; for each reader, find the largest
  // created_at ≤ their last_read_at. Linear scan is fine here (messages.length
  // is bounded by the conversation's loaded page window).
  for (const reader of readers) {
    if (!reader?.user_id) continue
    if (reader.user_id === myId) continue
    const lastRead = reader.last_read_at
    if (!lastRead) continue
    let latestId = null
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (!m || m.kind === 'system' || m.deleted_at) continue
      if (m.author_id === reader.user_id) continue
      if (m.created_at <= lastRead) { latestId = m.id; break }
    }
    if (!latestId) continue
    const arr = out.get(latestId) || []
    arr.push(reader)
    out.set(latestId, arr)
  }
  return out
}
