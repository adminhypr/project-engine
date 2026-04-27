// Pure helpers for task dependencies (soft / display-only).
// No supabase dependencies — testable in isolation.

// Given the dep rows for a single task and a lookup of all visible tasks,
// returns the blocker tasks (full task objects) that are NOT yet Done.
export function getOpenBlockers(blockerRows, taskById) {
  if (!Array.isArray(blockerRows) || !taskById) return []
  const out = []
  for (const row of blockerRows) {
    const t = taskById.get(row.blocker_id)
    if (t && t.status !== 'Done') out.push(t)
  }
  return out
}

export function hasOpenBlockers(blockerRows, taskById) {
  return getOpenBlockers(blockerRows, taskById).length > 0
}

// Returns the IDs of tasks that should be excluded from the dependency picker:
//   - the task itself (no self-dependency)
//   - already-linked blocker IDs (no duplicate)
//   - Done tasks (David's call: a Done task can't be a blocker)
export function buildExcludedPickerIds({ selfId, existingBlockerIds, allTasks }) {
  const excl = new Set()
  if (selfId) excl.add(selfId)
  for (const bid of existingBlockerIds || []) excl.add(bid)
  if (Array.isArray(allTasks)) {
    for (const t of allTasks) {
      if (t.status === 'Done') excl.add(t.id)
    }
  }
  return excl
}

// True if a status transition should trigger the soft warning toast.
// Only when moving INTO an active state (In Progress or Done) from
// something else, AND there are open blockers.
export function shouldWarnOnStatusChange(oldStatus, newStatus, openBlockerCount) {
  if (!openBlockerCount || openBlockerCount <= 0) return false
  if (oldStatus === newStatus) return false
  return newStatus === 'In Progress' || newStatus === 'Done'
}
