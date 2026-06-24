// Pure helpers for deciding WHEN a conversation pane should auto-mark-read.
//
// Two distinct triggers exist in the panes (SlackMessagePane / ConversationPane):
//   1. OPEN/SWITCH — the user just opened or switched to this conversation.
//      Clearing unread here is intended (they're looking at it).
//   2. NEW MESSAGE — a message arrived while the pane was already mounted.
//      Clearing unread here is ONLY correct if the user is actually looking:
//      the tab is visible, the window is focused, and they're scrolled to the
//      bottom (so the new message is on screen). Otherwise the message should
//      stay unread and badge.
//
// These are extracted as pure functions so the gating logic is unit-testable
// without a DOM. The pane wires document.visibilityState / document.hasFocus()
// / its atBottom state into them.

// Should opening/switching to a conversation mark it read?
// Intended behavior: yes, but only if the tab is in front (don't silently clear
// unread for a conversation rendered in a background tab on mount).
export function shouldMarkReadOnOpen({ visible }) {
  return !!visible
}

// Should a genuinely-new latest message mark the conversation read?
// Requires the user to be actively viewing: visible tab, focused window, and
// scrolled to the bottom. The widget additionally passes `activelyViewed` to
// exclude minimized / non-focused panes; when no such signal is available the
// caller passes `true` so visibility+focus+atBottom alone govern.
export function shouldMarkReadOnNewMessage({ visible, focused, atBottom, activelyViewed = true }) {
  return !!visible && !!focused && !!atBottom && !!activelyViewed
}

// Should returning to a hidden/blurred tab mark the OPEN conversation read?
// Closes a gap: a message arrived while the tab was hidden/blurred (so Effect 2
// correctly did NOT mark read), then the user comes back to the tab WITHOUT a
// new message arriving. This re-evaluates the same gate as Effect 2 minus the
// new-message requirement — visible + focused + at the bottom + actively viewed.
// Identical predicate to shouldMarkReadOnNewMessage so the two paths can never
// disagree.
export function shouldMarkReadOnFocusReturn({ visible, focused, atBottom, activelyViewed = true }) {
  return !!visible && !!focused && !!atBottom && !!activelyViewed
}

// Distinguish a genuinely-new latest message (a new TAIL) from a "Load earlier"
// prepend (older history added to the HEAD). Both grow messages.length, but only
// a new tail should be eligible to mark read.
//
// Returns true iff the newest (last) message id changed AND it is not a message
// that was already present earlier in the previous list (a prepend keeps the old
// tail id; a new tail introduces a brand-new last id).
export function isNewTail(prevLastId, nextLastId) {
  if (!nextLastId) return false
  if (!prevLastId) return false // first load is handled by the open/switch path
  return prevLastId !== nextLastId
}
