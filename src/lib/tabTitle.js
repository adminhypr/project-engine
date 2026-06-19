// Shared source of truth for the browser tab title so two independent hooks can
// compose it without fighting:
//   - usePageTitle(title)      → sets the per-page base title ("Chat — Hypr Task")
//   - useUnreadTabBadge()      → sets the unread prefix ("(3) ")
//
// Either can change at any time; we recompute document.title from both pieces
// whenever either updates. This avoids the classic bug where the page-title
// effect clobbers the unread prefix on navigation (or vice versa).

import { formatUnreadBadge } from './dmUnread'

export const BASE_TITLE = 'Hypr Task'

let currentBase = BASE_TITLE // full per-page title incl. " — Hypr Task"
let currentUnread = 0

function apply() {
  const prefix = formatUnreadBadge(currentUnread)
  document.title = prefix ? `(${prefix}) ${currentBase}` : currentBase
}

// Called by usePageTitle. `base` is the fully-formatted page title.
export function setBaseTitle(base) {
  currentBase = base || BASE_TITLE
  apply()
}

// Called by useUnreadTabBadge with the live total unread count.
export function setUnreadCount(n) {
  currentUnread = Number(n) || 0
  apply()
}
