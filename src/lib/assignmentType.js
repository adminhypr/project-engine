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
  Superior:  'bg-navy-100 text-navy-700',
  Peer:      'bg-sky-500/15 text-sky-700 backdrop-blur-sm',
  CrossTeam: 'bg-sky-500/25 text-sky-800 backdrop-blur-sm',
  Upward:    'bg-purple-500/15 text-purple-700 backdrop-blur-sm',
  Self:      'bg-navy-50 text-navy-400',
  Unknown:   'bg-navy-50 text-navy-400'
}
