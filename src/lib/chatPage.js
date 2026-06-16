// Pure helpers for the dedicated chat page (/chat). Kept free of React /
// Supabase so they're unit-testable. See
// docs/plans/2026-06-16-dedicated-chat-page-design.md.

const LAST_OPENED_PREFIX = 'pe-chat-last-'

// Per-profile "last conversation I had open on /chat", so returning to a bare
// /chat reopens where the user left off (Slack-style). Distinct from the
// widget's `pe-chat-state-{profileId}` key — they don't collide.
export function lastOpenedKey(profileId) {
  return `${LAST_OPENED_PREFIX}${profileId}`
}

export function readLastOpened(profileId, storage = globalThis.localStorage) {
  if (!profileId || !storage) return null
  try {
    const raw = storage.getItem(lastOpenedKey(profileId))
    return raw || null
  } catch {
    return null
  }
}

export function writeLastOpened(profileId, conversationId, storage = globalThis.localStorage) {
  if (!profileId || !conversationId || !storage) return
  try {
    storage.setItem(lastOpenedKey(profileId), conversationId)
  } catch {
    /* quota / disabled storage — non-fatal */
  }
}

export function clearLastOpened(profileId, storage = globalThis.localStorage) {
  if (!profileId || !storage) return
  try {
    storage.removeItem(lastOpenedKey(profileId))
  } catch {
    /* noop */
  }
}

// Resolve the fully-shaped conversation object the ConversationPane needs from
// the list + the route's :conversationId. Returns null when nothing is
// selected or the id isn't visible to the user (RLS-hidden / deleted / not
// loaded yet) — callers distinguish "no selection" from "not found" via the id.
export function resolveActiveConversation(conversations, conversationId) {
  if (!conversationId || !Array.isArray(conversations)) return null
  return conversations.find(c => c.id === conversationId) || null
}
