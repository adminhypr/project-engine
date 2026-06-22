// Touch affordance helpers for the chat surface.

// True when the primary pointer cannot hover (touch device). Drives mobile-only
// tap-to-reveal UI that would otherwise sit behind :hover.
export function isCoarsePointer() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(hover: none)').matches
}

// Decide whether a click on a message row should toggle its action toolbar.
// Pure so it is unit-testable: the component computes `hitInteractive` by testing
// whether the click target is inside a link/button/image/toolbar, and passes the
// coarse-pointer flag in.
export function shouldToggleMessageActions({ coarsePointer, hitInteractive }) {
  if (!coarsePointer) return false
  if (hitInteractive) return false
  return true
}
