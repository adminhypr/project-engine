# Chat page mobile optimization (Slack-mobile feel)

**Date:** 2026-06-22
**Status:** Design approved, ready for plan
**Scope:** The dedicated `/chat` takeover (`ChatPage.jsx`) and the components it
composes. No DB changes. No new routes. Desktop layout must be byte-for-byte
unchanged at the `md` breakpoint and above.

## Goal

Make the existing `/chat` page feel native on a phone — close to Slack mobile —
via a **targeted polish pass**, not a rebuild. The page is already a
Slack-faithful desktop redesign (`WorkspaceRail` 68px + `ChannelSidebar` 260px +
`SlackMessagePane`), adapted to mobile only through `hidden md:flex` visibility
toggles keyed on whether `conversationId` is in the URL. That adaptation breaks
in four concrete ways on a real phone; this design fixes each.

## Constraints / decisions (from brainstorming)

- **Ambition:** targeted polish pass, keep current single-pane structure.
- **Rail on mobile:** hidden entirely; list goes full-width. Rail actions
  relocate into the existing `WorkspaceHeader` dropdown.
- **Target:** mobile browser (Safari/Chrome) — plan for the URL bar and the iOS
  keyboard via `dvh` + `visualViewport`. Not a standalone PWA, but safe-area
  insets are applied defensively since they cost nothing.
- **Message actions on touch:** include a fix — **tap a message to toggle its
  action toolbar** (react / reply / thread / ⋮). Lightweight, no gesture lib.
- Desktop (`md+`) behavior and appearance unchanged everywhere.

## The four failures on a phone (root causes)

1. **Keyboard covers the composer.** `ChatPage.jsx:253` root is
   `h-screen w-screen`. `100vh` on iOS Safari includes the area behind the
   on-screen keyboard, so the bottom-anchored `ChatComposer` renders *under* the
   keyboard.
2. **iOS zoom-on-focus.** The composer textarea is `text-sm` = 14px
   (`ChatComposer.jsx:657`). iOS auto-zooms the page when focus lands on any
   input < 16px, jolting the layout.
3. **The 68px rail wastes width** on the list view, and naively hiding it would
   strip status / back-to-app / preferences affordances.
4. **Hover-only controls are dead on touch.** Sidebar star/× are
   `opacity-0 group-hover/row:opacity-100` (`SidebarRow.jsx:149,162`). The entire
   message action toolbar is `hidden group-hover/message:inline-flex`
   (`MessageRow.jsx:288`) — so on a phone you cannot react, reply, open a thread,
   or delete.

## Design — five work areas

### 1. Height + keyboard spine (foundation; everything else hangs off it)

- **Viewport meta** (`index.html:5`): add `viewport-fit=cover` (enables
  `env(safe-area-inset-*)`). Keep `width=device-width, initial-scale=1`. Append
  `interactive-widget=resizes-content` (helps Chrome Android keyboard; ignored by
  iOS Safari, harmless).
- **New hook `useVisualViewportHeight()`** (`src/hooks/useVisualViewportHeight.js`):
  while mounted, writes `window.visualViewport.height` (px) into a
  `--chat-vh` CSS custom property on `document.documentElement`, rAF-throttled,
  subscribed to `visualViewport` `resize` + `scroll`. Removes the listeners and
  clears the var on unmount. No-ops where `visualViewport` is undefined (older
  browsers fall through to the CSS fallback). **Mounted only by `ChatPage`** so it
  never runs on other routes or affects the floating widget.
- **Root container** (`ChatPage.jsx:252-255`): change `h-screen w-screen` →
  `fixed inset-0` + `style={{ height: 'var(--chat-vh, 100dvh)' }}` (with a
  `100vh` ultimate fallback for no-dvh browsers). `fixed` stops iOS from scrolling
  the document body behind the takeover. Because the root is an
  `overflow-hidden` flex column and `SlackMessageList` is the flexible scroller,
  shrinking the root to the visual-viewport height places the composer exactly
  above the keyboard.

This single change is what produces the "native" feel — the keyboard pushes the
conversation up instead of hiding the input.

### 2. Rail hidden on mobile, actions preserved

- **`ChatPage.jsx:247-248`**: the rail wrapper currently flips
  `conversationId ? 'hidden md:flex' : 'flex'`. Change to **always
  `hidden md:flex`** so the rail never shows on mobile. The sidebar wrapper keeps
  its `flex` / `hidden md:flex` swap (list shows when no conversation; pane shows
  when one is open). List is already `w-full md:w-auto` so it fills the width.
- **`WorkspaceHeader` dropdown** (`WorkspaceHeader.jsx:73-81`) already carries
  Invite / Preferences / Back to Project Engine / Sign out. Add the **status
  control** (Active / Away / Appear offline) here — reuse the same
  `presenceStatus` store wiring `ChatPage` already feeds the rail
  (`getStatus`/`setStatus`/`subscribe`). On mobile this is the only place to set
  status; on desktop the rail avatar keeps its own menu (unchanged). Pass the
  status props down from `ChatPage` → `ChannelSidebar` → `WorkspaceHeader`.
- "New message" needs no dedicated control on mobile: the full-width list puts the
  search field one tap away, which is the Slack "search + compose" entry point.
  The compose pencil (new group) stays in `WorkspaceHeader`.

### 3. Conversation header — back chevron + overflow

- **Remove** the standalone "All conversations" bar (`ChatPage.jsx:298-304`).
- **`ChannelHeader`**: add an optional `onBack` prop. When present (mobile only,
  passed as `() => navigate('/chat')`), render a **back chevron** as the first
  element of the `h-[50px]` row, left of the avatar/name. `md:hidden`.
- Collapse the right-side cluster on mobile. Assign-task / search / wallpaper /
  call become a **kebab `⋮` overflow menu** under `md` (`ChannelHeader.jsx:178-294`
  region). On `md+` they stay inline exactly as today. The Messages/Files/Links
  tab row stays.
- Header tap targets ≥ 44px on touch (`p-1.5` icons → larger hit area on mobile).

### 4. Composer declutter + safe area

- **Textarea** (`ChatComposer.jsx:657`): `text-sm` → `text-base md:text-sm`
  (16px on mobile kills the iOS focus-zoom; 14px preserved on desktop).
- **Action row** (`ChatComposer.jsx:571-644`): on mobile show only
  **[+ attach] [textarea] [emoji] [send]**. Hide on mobile (`hidden md:flex`):
  the formatting-toggle, `@`-mention, and GIF buttons, plus the drag-resize grip
  (`ChatComposer.jsx:561-570` — pointer-drag resize is meaningless on touch). `@`
  still works by typing it; formatting/GIF are desktop niceties. Desktop row
  unchanged.
- **Safe area**: composer outer container (`ChatComposer.jsx:477`) gets
  `pb-[env(safe-area-inset-bottom)]` (via a utility/inline style) so it clears the
  iOS home-indicator gesture strip.

### 5. Touch targets + hover-dead controls

- **`SidebarRow`** (`SidebarRow.jsx:91`): row height `h-7` (28px) → taller on
  mobile (`h-11 md:h-7` or padding equivalent) for a comfortable tap target.
  Make star/× **always visible on touch** — drop the `opacity-0` on coarse
  pointers (e.g. a `@media (hover: none)` rule, or `max-md:opacity-100`) so they're
  reachable; keep hover-reveal on desktop.
- **Message action toolbar** (`MessageRow.jsx:288`): currently hover/focus only.
  Add **tap-to-toggle on touch**: tapping a message row toggles a per-row "active"
  state that forces the toolbar visible (and the timestamp, `MessageRow.jsx:212`).
  Implementation: a local `active` state in `MessageRow`, toggled by an `onClick`
  that is a no-op on `md+` (hover already covers desktop) and ignores clicks that
  originate on links / images / the toolbar itself. Tapping elsewhere or opening
  another message's toolbar dismisses it. Reactions/reply/thread/delete all route
  through the existing handlers — no new actions, just reachability.

## Out of scope (YAGNI)

- Swipe-back / swipe-to-reply gestures, long-press haptics (the "full rebuild"
  path — not chosen).
- Bottom tab-bar navigation paradigm (rejected; rail simply hides).
- Pull-to-refresh, virtualized message list, message-content search.
- Any change to the floating `ChatWidget`, hubs, task chat, or DB.
  - **Shared-component note (decided during code review):** `ChatComposer` and
    `MessageRow` are shared by the widget / task chat / thread panels. The
    chat-page declutter (hiding the secondary composer buttons + the bottom
    safe-area padding) is gated behind a `fullPage` prop (passed only by
    `SlackMessagePane`) so those surfaces stay byte-for-byte unchanged. Two
    changes are intentionally left GLOBAL because they are universal mobile
    bug-fixes with no downside anywhere: the **16px composer textarea** (prevents
    iOS focus-zoom) and **tap-to-reveal message actions** (the only way to reach
    react/reply/thread/delete on touch — those toolbars were 100% hover-dead on
    every chat surface before this).
- Standalone-PWA chrome (status bar theming, install prompts). Safe-area insets
  are applied but no manifest/display-mode work.

## Risks & verification

- **iOS keyboard math is the high-risk piece.** Must be verified on a real
  iPhone Safari session: focus the composer, confirm it sits flush above the
  keyboard, confirm the message list scrolls under it, confirm no page-body
  scroll leak. Android Chrome second.
- **`fixed inset-0` regressions:** confirm modals (CreateGroup, Preferences,
  QuickSwitcher, Wallpaper) still layer above the takeover (they portal / use
  high z-index already) and that desktop is visually identical.
- **No desktop regressions:** every mobile change is gated behind `max-md`/
  `hidden md:flex`/`hover` media so `md+` renders exactly as today. Spot-check the
  resizable sidebar, rail status menu, and inline header controls.
- **Existing tests:** the chat logic libs (`chatPage`, `chatShortcuts`,
  `dmUnread`, etc.) are untouched; `npm run test:run` must stay green. New
  pure logic (e.g. a `coarsePointer` helper, if extracted) gets a unit test.
- Manual UI pass required (Google OAuth blocks headless login, per prior chat
  work) — list both the device matrix and the desktop-parity checklist in the
  implementation plan.

## Files touched (anticipated)

- `index.html` — viewport meta.
- `src/hooks/useVisualViewportHeight.js` — **new**.
- `src/pages/ChatPage.jsx` — root height/positioning, rail always-hidden on
  mobile, remove "All conversations" bar, pass `onBack` + status props.
- `src/components/chat/slack/WorkspaceHeader.jsx` — status control in dropdown.
- `src/components/chat/slack/ChannelSidebar.jsx` — thread status props through.
- `src/components/chat/slack/ChannelHeader.jsx` — back chevron + mobile overflow.
- `src/components/chat/ChatComposer.jsx` — textarea 16px, mobile action row,
  safe-area padding.
- `src/components/chat/slack/SidebarRow.jsx` — touch height + always-visible
  row actions.
- `src/components/chat/slack/MessageRow.jsx` — tap-to-reveal toolbar on touch.
- `src/index.css` — any shared mobile/safe-area helpers (e.g. `--chat-vh`
  fallback, `hover:none` rules) if cleaner than inline.
</content>
</invoke>
