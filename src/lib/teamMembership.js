// Team-membership predicates used by Admin Overview's "filter by Team".
//
// Background: tasks.team_id stores ONE team — the context the task was assigned
// in (assigner-picked team, or assignee's primary team at insert time). It does
// not track every team an assignee belongs to, and reassignTask() never updates
// it. So filtering by t.team_id misses tasks for multi-team users and tasks that
// were reassigned across teams. These helpers filter by assignee membership
// instead, using the team_ids enrichment that useProfiles() already builds.

export function buildTeamIdsByProfileId(profiles) {
  const map = new Map()
  for (const p of profiles || []) {
    if (!p?.id) continue
    const ids = (p.team_ids && p.team_ids.length > 0)
      ? p.team_ids
      : (p.team_id ? [p.team_id] : [])
    map.set(p.id, new Set(ids))
  }
  return map
}

export function taskOnTeam(task, teamId, teamIdsByProfileId) {
  if (!teamId) return false
  const list = task.assignees && task.assignees.length > 0
    ? task.assignees.map(a => a.id)
    : (task.assigned_to ? [task.assigned_to] : [])
  for (const id of list) {
    if (teamIdsByProfileId.get(id)?.has(teamId)) return true
  }
  return false
}
