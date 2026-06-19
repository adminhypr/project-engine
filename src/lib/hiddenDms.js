// Per-profile "hidden / closed DMs" store for the Slack sidebar. Pure
// localStorage wrappers (no React / Supabase) so they're unit-testable and
// reusable. Hiding a DM only affects the sidebar presentation — there is NO
// DB change. A hidden DM reappears (and is un-hidden) on a new message or when
// it's reopened; that policy lives in ChannelSidebar, not here.

const PREFIX = 'pe-slack-hidden-dms-'

export function hiddenDmsKey(profileId) {
  return `${PREFIX}${profileId}`
}

// Returns an array of hidden conversationIds (deduped, strings only).
export function readHiddenDms(profileId, storage = globalThis.localStorage) {
  if (!profileId || !storage) return []
  try {
    const raw = storage.getItem(hiddenDmsKey(profileId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter(id => typeof id === 'string' && id))]
  } catch {
    return []
  }
}

function writeHiddenDms(profileId, ids, storage) {
  try {
    storage.setItem(hiddenDmsKey(profileId), JSON.stringify(ids))
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

// Add a conversationId to the hidden set. Returns the new array.
export function hideDm(profileId, conversationId, storage = globalThis.localStorage) {
  const current = readHiddenDms(profileId, storage)
  if (!profileId || !conversationId || !storage) return current
  if (current.includes(conversationId)) return current
  const next = [...current, conversationId]
  writeHiddenDms(profileId, next, storage)
  return next
}

// Remove a conversationId from the hidden set. Returns the new array.
export function unhideDm(profileId, conversationId, storage = globalThis.localStorage) {
  const current = readHiddenDms(profileId, storage)
  if (!profileId || !conversationId || !storage) return current
  if (!current.includes(conversationId)) return current
  const next = current.filter(id => id !== conversationId)
  writeHiddenDms(profileId, next, storage)
  return next
}
