// Pure helpers for sub-tasks. No supabase dependencies — tested in isolation.

export function isSubtask(task) {
  return Boolean(task && task.parent_task_id)
}

export function isParent(task, allTasks) {
  if (!task || !Array.isArray(allTasks)) return false
  return allTasks.some(t => t.parent_task_id === task.id)
}

// Returns children of `parentId` from `allTasks`, in original order (caller can re-sort).
export function getChildren(parentId, allTasks) {
  if (!parentId || !Array.isArray(allTasks)) return []
  return allTasks.filter(t => t.parent_task_id === parentId)
}

// Counts of sub-tasks for a given parent: total + open (status !== 'Done').
// Pre-computes a Map so repeat calls in a render pass are cheap.
export function buildSubtaskCounts(allTasks) {
  const counts = new Map()
  if (!Array.isArray(allTasks)) return counts
  for (const t of allTasks) {
    if (!t.parent_task_id) continue
    const cur = counts.get(t.parent_task_id) || { total: 0, open: 0 }
    cur.total += 1
    if (t.status !== 'Done') cur.open += 1
    counts.set(t.parent_task_id, cur)
  }
  return counts
}

// True if any of the given tasks is a parent — used to gate the hide-subtasks toggle.
export function anyHasSubtasks(allTasks) {
  if (!Array.isArray(allTasks)) return false
  const seen = new Set()
  for (const t of allTasks) {
    if (t.parent_task_id) {
      if (seen.has(t.parent_task_id)) return true
      seen.add(t.parent_task_id)
      return true
    }
  }
  return false
}

// Filter out sub-task rows when `hide` is true. Preserves parents.
export function applyHideSubtasksFilter(tasks, hide) {
  if (!hide) return tasks
  if (!Array.isArray(tasks)) return tasks
  return tasks.filter(t => !t.parent_task_id)
}

// Truncate parent title for the "↳ parent" hint pill.
export function truncateParentLabel(title, max = 24) {
  if (!title) return ''
  if (title.length <= max) return title
  return title.slice(0, max - 1).trimEnd() + '…'
}
