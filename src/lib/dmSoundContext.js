// Tiny module-level context so the global useDmRealtime sound trigger
// can ask "should this ping?" without coupling to ChatWidget's state.
//
// ChatWidget pushes the muted-conversation set + the currently maximised
// conversation id whenever they change. useDmRealtime calls
// shouldPlaySoundFor(convId) right before playMessageSound().
//
// Defaults are permissive — if no one has registered context yet, sounds
// play (matches pre-refactor behavior on cold load).

let _muted = new Set()
let _maximizedId = null

export function setMutedConvIds(iter) {
  _muted = new Set(iter || [])
}

export function setMaximizedConvId(id) {
  _maximizedId = id || null
}

// Current maximised/focused conversation id (or null when several widget panes
// are shown side-by-side with none focused). Read by ConversationPane to gate
// auto-mark-read: a pane is "actively viewed" when it's the focused one, or when
// nothing is focused (side-by-side mode — every open pane is visible).
export function getMaximizedConvId() {
  return _maximizedId
}

// Is a conversation currently muted? Used by the desktop-notification path in
// useDmRealtime (which shouldn't notify for muted threads).
export function isConvMuted(convId) {
  return !!convId && _muted.has(convId)
}

export function shouldPlaySoundFor(convId) {
  if (!convId) return true
  if (_muted.has(convId)) return false
  // If the user has the conv maximised AND the tab is in front, they're
  // actively reading it — don't ping.
  if (_maximizedId === convId
      && typeof document !== 'undefined'
      && document.visibilityState === 'visible') {
    return false
  }
  return true
}
