// Per-user, per-conversation draft persistence for the DM composer.
// Drafts survive page reloads, closing/reopening a pane, and temporary
// send failures — the text isn't lost just because the realtime socket
// hiccupped or the user navigated away mid-sentence.
//
// Stored under localStorage key `pe-draft-{profileId}-{conversationId}`.
// Value shape: { text, replyTo, mentions, updatedAt } — images are not
// persisted because their blob URLs don't survive a reload.

function key(profileId, conversationId, threadRootId) {
  const base = `pe-draft-${profileId}-${conversationId}`
  return threadRootId ? `${base}-t-${threadRootId}` : base
}

export function readDraft(profileId, conversationId, threadRootId) {
  if (!profileId || !conversationId) return null
  try {
    const raw = localStorage.getItem(key(profileId, conversationId, threadRootId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      replyTo: parsed.replyTo || null,
      mentions: Array.isArray(parsed.mentions) ? parsed.mentions : [],
      updatedAt: parsed.updatedAt || null,
    }
  } catch {
    return null
  }
}

export function writeDraft(profileId, conversationId, draft, threadRootId) {
  if (!profileId || !conversationId) return
  try {
    const empty = !draft || (
      (!draft.text || !draft.text.trim())
      && !draft.replyTo
      && (!draft.mentions || draft.mentions.length === 0)
    )
    if (empty) {
      localStorage.removeItem(key(profileId, conversationId, threadRootId))
      return
    }
    localStorage.setItem(key(profileId, conversationId, threadRootId), JSON.stringify({
      text: draft.text || '',
      replyTo: draft.replyTo || null,
      mentions: draft.mentions || [],
      updatedAt: new Date().toISOString(),
    }))
  } catch { /* noop */ }
}

export function clearDraft(profileId, conversationId, threadRootId) {
  if (!profileId || !conversationId) return
  try { localStorage.removeItem(key(profileId, conversationId, threadRootId)) } catch { /* noop */ }
}
