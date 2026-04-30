// Sum unread counts across the items in a chat-widget section so the
// section header can show a red badge when collapsed (and as a quick
// scan-by signal when expanded).
//
// Two row shapes flow into ContactList:
//   • Group/Campfire/Task rows: the row IS the conversation, so the
//     unread count lives on `row.unread`.
//   • People rows (Recent/Teammates/Company): the row is
//     `{ profile, conversation }` and the unread count lives on
//     `row.conversation.unread`.
//
// Pass `kind: 'people'` for the latter shape.

export function totalUnread(rows, kind = 'conversation') {
  if (!Array.isArray(rows) || rows.length === 0) return 0
  return rows.reduce((sum, r) => {
    const n = kind === 'people' ? (r?.conversation?.unread || 0) : (r?.unread || 0)
    return sum + (Number.isFinite(n) && n > 0 ? n : 0)
  }, 0)
}
