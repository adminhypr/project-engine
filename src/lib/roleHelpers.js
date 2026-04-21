export function isAgent(profile) {
  return profile?.role === 'Agent'
}

export function isClient(profile) {
  return profile?.role === 'Client'
}

export function isExternal(profile) {
  return profile?.role === 'Agent' || profile?.role === 'Client'
}
