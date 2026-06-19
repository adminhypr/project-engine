// Per-profile "starred / favorite conversations" store for the Slack sidebar.
// Pure localStorage wrappers (no React / Supabase) so they're unit-testable and
// reusable. Starring a conversation only affects the sidebar presentation —
// there is NO DB change. Mirrors the hiddenDms.js pattern exactly. A starred
// conversation (channel, DM, or task) is surfaced in a dedicated "Starred"
// section at the top of the sidebar; that policy lives in ChannelSidebar.

const PREFIX = 'pe-slack-starred-'

export function starredKey(profileId) {
  return `${PREFIX}${profileId}`
}

// Returns an array of starred conversationIds (deduped, strings only).
export function readStarred(profileId, storage = globalThis.localStorage) {
  if (!profileId || !storage) return []
  try {
    const raw = storage.getItem(starredKey(profileId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter(id => typeof id === 'string' && id))]
  } catch {
    return []
  }
}

function writeStarred(profileId, ids, storage) {
  try {
    storage.setItem(starredKey(profileId), JSON.stringify(ids))
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

// Add a conversationId to the starred set. Returns the new array.
export function starConversation(profileId, conversationId, storage = globalThis.localStorage) {
  const current = readStarred(profileId, storage)
  if (!profileId || !conversationId || !storage) return current
  if (current.includes(conversationId)) return current
  const next = [...current, conversationId]
  writeStarred(profileId, next, storage)
  return next
}

// Remove a conversationId from the starred set. Returns the new array.
export function unstarConversation(profileId, conversationId, storage = globalThis.localStorage) {
  const current = readStarred(profileId, storage)
  if (!profileId || !conversationId || !storage) return current
  if (!current.includes(conversationId)) return current
  const next = current.filter(id => id !== conversationId)
  writeStarred(profileId, next, storage)
  return next
}

// Convenience predicate. Reads the set each call — fine for one-off checks; for
// list rendering build a Set from readStarred once and use Set.has instead.
export function isStarred(profileId, conversationId, storage = globalThis.localStorage) {
  if (!conversationId) return false
  return readStarred(profileId, storage).includes(conversationId)
}
