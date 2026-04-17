const RECENT_CAP = 8

export function bucketContacts({ profiles, conversations, myId, myTeamIds }) {
  const myTeamSet = new Set(myTeamIds || [])

  const sortedConvs = [...(conversations || [])]
    .filter(c => c.other_user_id && c.other_user_id !== myId)
    .sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at))
    .slice(0, RECENT_CAP)

  const profileById = new Map(profiles.map(p => [p.id, p]))
  const recent = []
  const recentIdSet = new Set()
  for (const c of sortedConvs) {
    const prof = profileById.get(c.other_user_id)
    if (!prof) continue
    recent.push({ profile: prof, conversation: c })
    recentIdSet.add(prof.id)
  }

  const teammates = []
  const company = []
  for (const prof of profiles) {
    if (prof.id === myId) continue
    if (recentIdSet.has(prof.id)) continue
    const teamIds = Array.isArray(prof.team_ids) ? prof.team_ids : []
    const sharesTeam = teamIds.some(tid => myTeamSet.has(tid))
    if (sharesTeam) teammates.push({ profile: prof })
    else company.push({ profile: prof })
  }

  const byName = (a, b) => (a.profile.full_name || '').localeCompare(b.profile.full_name || '')
  teammates.sort(byName)
  company.sort(byName)

  return { recent, teammates, company }
}

export function filterContactsBySearch(sections, rawQuery) {
  const q = (rawQuery || '').trim().toLowerCase()
  if (!q) return sections
  const match = row => (row.profile.full_name || '').toLowerCase().includes(q)
  return {
    recent:    sections.recent.filter(match),
    teammates: sections.teammates.filter(match),
    company:   sections.company.filter(match),
  }
}
