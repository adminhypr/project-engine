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
  Superior:  'bg-slate-100 text-slate-700',
  Peer:      'bg-sky-50 text-sky-700',
  CrossTeam: 'bg-blue-50 text-blue-700',
  Upward:    'bg-purple-50 text-purple-700',
  Self:      'bg-slate-50 text-slate-400',
  Unknown:   'bg-slate-50 text-slate-400'
}
