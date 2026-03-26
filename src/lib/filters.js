export function applyFilters(tasks, filters) {
  return tasks.filter(t => {
    if (filters.statuses?.length && !filters.statuses.includes(t.status)) return false
    if (filters.status && t.status !== filters.status) return false
    if (filters.urgency  && t.urgency  !== filters.urgency)  return false
    if (filters.priority && t.priority !== filters.priority) return false
    if (filters.team     && t.team_id  !== filters.team)     return false
    if (filters.acceptance && t.acceptance_status !== filters.acceptance) return false
    if (filters.search) {
      const q = filters.search.toLowerCase()
      const assigneeNamesMatch = t.assignees?.some(a => (a.full_name || '').toLowerCase().includes(q))
      if (!t.title.toLowerCase().includes(q) &&
          !(t.task_id || '').toLowerCase().includes(q) &&
          !(t.assignee?.full_name || '').toLowerCase().includes(q) &&
          !assigneeNamesMatch &&
          !(t.assigner?.full_name || '').toLowerCase().includes(q) &&
          !(t.who_due_to || '').toLowerCase().includes(q)) return false
    }
    return true
  })
}
