const KEY = (pid) => `pe-active-team-${pid}`

export function getStoredActiveTeamId(profileId) {
  if (!profileId) return null
  try {
    return localStorage.getItem(KEY(profileId)) || null
  } catch {
    return null
  }
}

export function setStoredActiveTeamId(profileId, teamId) {
  if (!profileId) return
  try {
    if (teamId) localStorage.setItem(KEY(profileId), teamId)
    else localStorage.removeItem(KEY(profileId))
  } catch {
    /* noop */
  }
}

export function pickDefaultTeam(profile) {
  const teams = profile?.all_teams || []
  if (teams.length === 0) return null
  const primary = teams.find(t => t?.is_primary)
  return primary?.id || teams[0]?.id || null
}
