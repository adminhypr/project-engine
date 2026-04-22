export function groupTodosByHub(items) {
  if (!items || items.length === 0) return []
  const byHub = new Map()
  for (const it of items) {
    const hubId = it.hub?.id || it.hub_id
    if (!byHub.has(hubId)) byHub.set(hubId, { hub: it.hub || { id: hubId }, lists: new Map() })
    const hub = byHub.get(hubId)
    const listId = it.list?.id || it.list_id
    if (!hub.lists.has(listId)) hub.lists.set(listId, { list: it.list || { id: listId }, items: [] })
    hub.lists.get(listId).items.push(it)
  }
  return Array.from(byHub.values()).map(h => ({
    hub: h.hub,
    lists: Array.from(h.lists.values()),
  }))
}

export function filterTodosByStatus(items, status) {
  if (status === 'all' || !status) return items
  if (status === 'open') return items.filter(i => !i.completed_at)
  if (status === 'completed') return items.filter(i => !!i.completed_at)
  return items
}

export function filterTodosByDue(items, mode) {
  if (mode === 'all' || !mode) return items
  const now = Date.now()
  const weekMs = 7 * 24 * 60 * 60 * 1000
  return items.filter(i => {
    if (mode === 'none') return !i.due_date
    if (!i.due_date) return false
    const t = new Date(i.due_date).getTime()
    if (mode === 'overdue') return t < now
    if (mode === 'week') return t >= now && t <= now + weekMs
    return true
  })
}
