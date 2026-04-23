// src/lib/perAssigneeCompletion.js

export function isAssigneeOpen(row) {
  return !row?.completed_at
}

export function allAssigneesComplete(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false
  return rows.every((r) => !!r?.completed_at)
}

export function completionProgress(rows) {
  if (!Array.isArray(rows)) return { done: 0, total: 0 }
  const total = rows.length
  const done = rows.filter((r) => !!r?.completed_at).length
  return { done, total }
}

export function canForceClose(task, userId, isAdmin) {
  if (!task || !userId) return false
  if (isAdmin) return true
  if (task.assigned_by === userId) return true
  const assignees = task.task_assignees ?? []
  return assignees.some((r) => r?.profile_id === userId)
}
