export const DEFAULT_STATE = Object.freeze({
  expanded: false,
  openConversationIds: [],
  minimizedIds: [],
})

function storageKey(profileId) {
  return `pe-chat-state-${profileId}`
}

function isValidState(value) {
  return value
    && typeof value === 'object'
    && typeof value.expanded === 'boolean'
    && Array.isArray(value.openConversationIds)
    && Array.isArray(value.minimizedIds)
}

export function readWidgetState(profileId) {
  if (!profileId) return { ...DEFAULT_STATE }
  try {
    const raw = localStorage.getItem(storageKey(profileId))
    if (!raw) return { ...DEFAULT_STATE }
    const parsed = JSON.parse(raw)
    if (!isValidState(parsed)) return { ...DEFAULT_STATE }
    return parsed
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function writeWidgetState(profileId, state) {
  if (!profileId) return
  try {
    localStorage.setItem(storageKey(profileId), JSON.stringify(state))
  } catch {
    // localStorage can be unavailable (private mode, quota, etc.) — silent fail is fine
  }
}

export function clearWidgetState(profileId) {
  if (!profileId) return
  localStorage.removeItem(storageKey(profileId))
}
