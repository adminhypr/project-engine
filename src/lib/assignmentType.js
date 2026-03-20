export const ROLE_RANK = { Admin: 3, Manager: 2, Staff: 1 }

export function getAssignmentType(assigner, assignee) {
  if (!assigner || !assignee) return 'Unknown'
  const ar = ROLE_RANK[assigner.role] || 1
  const er = ROLE_RANK[assignee.role] || 1
  if (assigner.id === assignee.id)              return 'Self'
  if (assigner.role === 'Admin')                return 'Superior'
  if (ar > er && assigner.team_id === assignee.team_id) return 'Superior'
  if (ar > er && assigner.team_id !== assignee.team_id) return 'CrossTeam'
  if (ar === er && assigner.team_id === assignee.team_id) return 'Peer'
  if (ar === er && assigner.team_id !== assignee.team_id) return 'CrossTeam'
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
