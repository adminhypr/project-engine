// Pure helpers for the Settings page redesign (Users table + edit drawer).
// See docs/plans/2026-07-05-settings-redesign-design.md.
//
// Terminology the UI shows admins:
//   Account type  — Internal | Agent | Client   (from the sticky global role)
//   Access level  — Admin | Manager | Staff     (internal ladder; null for externals)
// `profiles.role` is canonical for both: the role-sync trigger (migration 010)
// keeps it at the max per-team role, and externals are sticky (038).

import { isExternal } from './roleHelpers'

const asArray = (v) => (Array.isArray(v) ? v : [])

export function getAccountType(profile) {
  const role = profile?.role
  if (role === 'Agent' || role === 'Client') return role
  return 'Internal'
}

// Internal access ladder. Externals return null — they have no internal
// access level, and the drawer hides that section for them entirely.
export function getAccessLevel(profile) {
  if (isExternal(profile)) return null
  const role = profile?.role
  if (role === 'Admin' || role === 'Manager') return role
  return 'Staff'
}

const teamName = (pt) => pt?.team?.name || 'Unknown'

// Primary team first, the rest alphabetical; cap at maxVisible with an
// overflow count for a "+N" chip.
export function summarizeTeams(profileTeams, maxVisible = 2) {
  const rows = asArray(profileTeams)
  const sorted = [...rows].sort((a, b) => {
    if (a?.is_primary !== b?.is_primary) return a?.is_primary ? -1 : 1
    return teamName(a).localeCompare(teamName(b))
  })
  const withNames = sorted.map(pt => ({ ...pt, name: teamName(pt) }))
  return {
    visible: withNames.slice(0, maxVisible),
    overflow: Math.max(0, withNames.length - maxVisible),
  }
}

// Search (name / email / team name, case-insensitive) + team membership +
// account type. Empty/missing filter dimensions pass everything through.
export function filterUsers(profiles, { search = '', teamId = '', type = '' } = {}) {
  const q = search.trim().toLowerCase()
  return asArray(profiles).filter(p => {
    if (q) {
      const haystack = [
        p?.full_name || '',
        p?.email || '',
        ...asArray(p?.profile_teams).map(teamName),
      ].join(' ').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    if (teamId && !asArray(p?.profile_teams).some(pt => pt?.team_id === teamId)) return false
    if (type && getAccountType(p) !== type) return false
    return true
  })
}
