export const ROLE_RANK = { Admin: 3, Manager: 2, Staff: 1 }

/**
 * Check if two users share any team.
 * Supports both legacy (single team_id) and multi-team (team_ids array).
 */
function shareTeam(a, b) {
  // Multi-team: check if any team_ids overlap
  if (a.team_ids?.length && b.team_ids?.length) {
    return a.team_ids.some(id => b.team_ids.includes(id))
  }
  // Fallback to legacy single team_id
  return a.team_id != null && a.team_id === b.team_id
}

export function getAssignmentType(assigner, assignee, teamId) {
  if (!assigner || !assignee) return 'Unknown'
  if (assigner.id === assignee.id) return 'Self'
  if (assigner.role === 'Admin') return 'Superior'

  // Per-team role: when teamId provided, use team-specific roles
  const ar = teamId && assigner.team_roles?.[teamId]
    ? (ROLE_RANK[assigner.team_roles[teamId]] || 1)
    : (ROLE_RANK[assigner.role] || 1)
  const er = teamId && assignee.team_roles?.[teamId]
    ? (ROLE_RANK[assignee.team_roles[teamId]] || 1)
    : (ROLE_RANK[assignee.role] || 1)

  const sameTeam = shareTeam(assigner, assignee)
  if (ar > er && sameTeam)  return 'Superior'
  if (ar > er && !sameTeam) return 'CrossTeam'
  if (ar === er && sameTeam)  return 'Peer'
  if (ar === er && !sameTeam) return 'CrossTeam'
  if (ar < er) return 'Upward'
  return 'Peer'
}

export const ASSIGNMENT_TYPE_STYLES = {
  Superior:  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  Peer:      'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400',
  CrossTeam: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  Upward:    'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-400',
  Self:      'bg-slate-50 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
  Unknown:   'bg-slate-50 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
}
