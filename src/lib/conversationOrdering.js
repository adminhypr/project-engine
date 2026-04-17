export function sortByLastMessage(conversations) {
  return [...(conversations || [])].sort(
    (a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at)
  )
}

export function upsertConversation(list, updated) {
  const others = (list || []).filter(c => c.id !== updated.id)
  return sortByLastMessage([updated, ...others])
}
