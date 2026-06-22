# Chat Page Mobile Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the `/chat` takeover feel native on a phone (Slack-mobile quality) via a targeted polish pass — keyboard-aware composer, rail hidden, real back/overflow header, decluttered composer, and touch-reachable actions — with desktop (`md+`) unchanged.

**Architecture:** All changes are gated behind mobile media (`max-md`, `hidden md:flex`, `(hover:none)`) or new optional props that default to today's behavior, so the desktop layout is byte-for-byte identical. The one structural change is the root container sizing to the visual viewport so the on-screen keyboard pushes the conversation up instead of covering the composer. No DB, no routes, no changes to the floating `ChatWidget`.

**Tech Stack:** React 18 + Vite, Tailwind CSS 3 (`darkMode:'class'`), `window.visualViewport` API, CSS `dvh` + `env(safe-area-inset-*)`, Vitest for pure-logic units. Design doc: `docs/plans/2026-06-22-chat-mobile-optimization-design.md`.

**Verification reality:** This app has **no component/integration tests** — only pure-logic Vitest suites in `src/lib/__tests__/`. So: new *pure helpers* get real failing-test-first units; *UI changes* are verified by (a) `npm run test:run` staying green, (b) `npm run build` succeeding, and (c) an explicit manual device checklist at the end. Google OAuth blocks headless login, so the keyboard behavior MUST be checked on a real iPhone Safari + Android Chrome session.

**Batches (review checkpoint after each):**
- **Batch A** — Keyboard + height spine (highest risk)
- **Batch B** — Rail hidden + header (back chevron, overflow, status relocation)
- **Batch C** — Composer declutter + safe area
- **Batch D** — Touch targets + tap-to-reveal message actions

---

## BATCH A — Keyboard + height spine

The foundation. After this batch, the composer should sit above the keyboard on a real phone. **Stop and review (incl. device check) before Batch B.**

### Task A1: Viewport meta — enable safe-area + keyboard-resize hints

**Files:**
- Modify: `index.html:5`

**Step 1: Edit the meta tag**

Replace line 5:
```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
```
with:
```html
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
```

Why: `viewport-fit=cover` is required for `env(safe-area-inset-*)` to return non-zero. `interactive-widget=resizes-content` makes Chrome Android resize the layout when the keyboard opens (ignored by iOS Safari — harmless). Removing `.0` from `initial-scale` is cosmetic.

**Step 2: Verify the app still boots**

Run: `npm run build`
Expected: build succeeds (this is a static HTML change; nothing imports it).

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat(chat-mobile): viewport-fit=cover + interactive-widget for keyboard/safe-area"
```

---

### Task A2: Pure helper `chatViewportHeightPx` (TDD)

A tiny pure function the hook will use, so the px-string logic is unit-covered without mocking the DOM.

**Files:**
- Create: `src/lib/chatViewport.js`
- Test: `src/lib/__tests__/chatViewport.test.js`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { chatViewportHeightPx } from '../chatViewport'

describe('chatViewportHeightPx', () => {
  it('rounds the visualViewport height to a px string', () => {
    expect(chatViewportHeightPx({ height: 812.4 })).toBe('812px')
    expect(chatViewportHeightPx({ height: 640 })).toBe('640px')
  })
  it('returns null when no viewport / height is given', () => {
    expect(chatViewportHeightPx(null)).toBeNull()
    expect(chatViewportHeightPx(undefined)).toBeNull()
    expect(chatViewportHeightPx({})).toBeNull()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/__tests__/chatViewport.test.js`
Expected: FAIL — "Failed to resolve import '../chatViewport'".

**Step 3: Write the minimal implementation**

```js
// Pure helper for useVisualViewportHeight: maps a VisualViewport-like object to
// the px string we store in the --chat-vh CSS custom property. Extracted so the
// rounding/guard logic is unit-tested without a DOM.
export function chatViewportHeightPx(vv) {
  if (!vv || typeof vv.height !== 'number') return null
  return `${Math.round(vv.height)}px`
}
```

**Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/__tests__/chatViewport.test.js`
Expected: PASS (both tests).

**Step 5: Commit**

```bash
git add src/lib/chatViewport.js src/lib/__tests__/chatViewport.test.js
git commit -m "feat(chat-mobile): chatViewportHeightPx pure helper + tests"
```

---

### Task A3: `useVisualViewportHeight` hook

**Files:**
- Create: `src/hooks/useVisualViewportHeight.js`

**Step 1: Write the hook**

```js
import { useEffect } from 'react'
import { chatViewportHeightPx } from '../lib/chatViewport'

// While mounted, mirrors window.visualViewport.height into a `--chat-vh` CSS
// custom property on <html>. A full-screen chat surface sizes itself to
// `var(--chat-vh, 100dvh)` so it always equals the area NOT covered by the
// on-screen keyboard.
//
// Why this is needed: on iOS Safari the layout viewport (100vh / 100dvh) does
// NOT shrink when the keyboard opens — only the *visual* viewport does. A
// bottom-anchored composer sized to 100dvh therefore hides behind the keyboard.
// Reading visualViewport.height fixes that.
//
// rAF-throttled; clears the var and listeners on unmount. No-ops where
// visualViewport is unavailable (desktop/older browsers fall through to the
// 100dvh CSS fallback). Mount this ONLY on the full-page chat route.
export function useVisualViewportHeight() {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return undefined
    const root = document.documentElement
    let raf = 0
    const apply = () => {
      raf = 0
      const px = chatViewportHeightPx(vv)
      if (px) root.style.setProperty('--chat-vh', px)
    }
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(apply)
    }
    apply()
    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv.removeEventListener('resize', schedule)
      vv.removeEventListener('scroll', schedule)
      root.style.removeProperty('--chat-vh')
    }
  }, [])
}
```

**Step 2: Verify it compiles**

Run: `npm run build`
Expected: build succeeds (the hook is not yet imported; this just confirms no syntax error). If the linter flags an unused file, that's fine — Task A4 wires it.

**Step 3: Commit**

```bash
git add src/hooks/useVisualViewportHeight.js
git commit -m "feat(chat-mobile): useVisualViewportHeight hook (writes --chat-vh)"
```

---

### Task A4: Wire the hook + resize the `/chat` root to the visual viewport

**Files:**
- Modify: `src/pages/ChatPage.jsx` (import + mount the hook; change the root element)

**Step 1: Import the hook**

Add near the other hook imports (after line 15, `import { useChatPrefs } ...`):
```js
import { useVisualViewportHeight } from '../hooks/useVisualViewportHeight'
```

**Step 2: Mount it inside the component**

Just after `const { conversationId } = useParams()` (line 35), add:
```js
  // Keep the full-page chat sized to the visual viewport so the iOS keyboard
  // pushes the conversation up instead of covering the composer.
  useVisualViewportHeight()
```

**Step 3: Change the root element height + positioning**

At `ChatPage.jsx:252-255`, replace:
```jsx
    <div
      className="slack-chat h-screen w-screen flex overflow-hidden bg-[var(--chat-sidebar,#1a1d24)]"
      style={sidebarThemeVars(chatPrefs.sidebarTheme)}
    >
```
with:
```jsx
    <div
      className="slack-chat fixed inset-0 flex overflow-hidden bg-[var(--chat-sidebar,#1a1d24)]"
      style={{ ...sidebarThemeVars(chatPrefs.sidebarTheme), height: 'var(--chat-vh, 100dvh)' }}
    >
```

Notes:
- `fixed inset-0` stops iOS from scrolling the document body behind the takeover when the keyboard opens.
- `height: var(--chat-vh, 100dvh)` — `--chat-vh` is set live by the hook on mobile; desktop and non-`visualViewport` browsers fall back to `100dvh` (and `h-screen`'s old `100vh` is no longer needed because `inset-0` + dvh cover it). The element is already an `overflow-hidden` flex column whose message list is the internal scroller, so shrinking it pins the composer to the keyboard top.

**Step 4: Verify desktop + tests**

Run: `npm run test:run`
Expected: PASS (no logic changed).
Run: `npm run build`
Expected: success.
Run: `npm run dev`, open `http://localhost:5173/chat` in a **desktop** browser → the page should look identical to before (full viewport, 3 panes). Resize the window narrow (< 768px) in devtools → rail still visible for now (Batch B hides it); list full-width; composer at the bottom.

**Step 5: Commit**

```bash
git add src/pages/ChatPage.jsx
git commit -m "feat(chat-mobile): size /chat root to visual viewport (keyboard-aware)"
```

---

### Task A5: Device smoke (manual) — Batch A checkpoint

Not a code step — the review gate. On a **real iPhone Safari** (and Android Chrome if available), load `/chat`, open a conversation, tap the composer:
- [ ] Composer sits flush above the keyboard (not behind it).
- [ ] The message list scrolls under the header/above the composer.
- [ ] No "rubber-band" of the whole page behind the keyboard.
- [ ] Dismissing the keyboard restores full height with no dead gap at the bottom.

**If the composer drifts (visible gap between it and the keyboard):** iOS likely reported `visualViewport.offsetTop > 0`. Fallback fix (apply only if observed): in the hook also set `root.style.setProperty('--chat-vo', \`${Math.round(vv.offsetTop)}px\`)` and add `transform: translateY(var(--chat-vo, 0))` to the root, subtracting `offsetTop` from the height. Document the result either way. **Pause here for review.**

---

## BATCH B — Rail hidden on mobile + header (back, overflow, status)

After this batch the mobile list is full-width with no dark rail, the conversation has a real back arrow, and the header's secondary actions live behind a `⋮`. **Stop and review before Batch C.**

### Task B1: Hide the workspace rail on mobile

**Files:**
- Modify: `src/pages/ChatPage.jsx:247`

**Step 1: Make the rail desktop-only**

At `ChatPage.jsx:247`, replace:
```js
  const railVisibility = conversationId ? 'hidden md:flex' : 'flex'
```
with:
```js
  // Rail is desktop-only on the mobile-optimized page: its actions live in the
  // sidebar's WorkspaceHeader dropdown (status, preferences, back-to-app) on a
  // phone. Always hidden under md.
  const railVisibility = 'hidden md:flex'
```

(`sidebarVisibility` and `mainVisibility` are unchanged — the list still swaps to the pane when a conversation opens.)

**Step 2: Verify**

Run: `npm run build` → success.
In devtools mobile view (< 768px) on `/chat`: the 68px dark rail is gone; the conversation list fills the width. Desktop (≥ 768px) unchanged.

**Step 3: Commit**

```bash
git add src/pages/ChatPage.jsx
git commit -m "feat(chat-mobile): hide workspace rail under md"
```

---

### Task B2: Relocate the status control into `WorkspaceHeader` (mobile parity)

The rail owned the Active/Away/Appear-offline control. With the rail hidden, surface it in the sidebar header dropdown so phone users can still set status. Thread the props `ChatPage → ChannelSidebar → WorkspaceHeader`.

**Files:**
- Modify: `src/components/chat/slack/WorkspaceHeader.jsx`
- Modify: `src/components/chat/slack/ChannelSidebar.jsx` (pass-through)
- Modify: `src/pages/ChatPage.jsx` (pass status props to `ChannelSidebar`)

**Step 1: Accept status props in `WorkspaceHeader`**

In `WorkspaceHeader.jsx`, extend the signature (line 16) to add `selfStatus`, `manualStatus`, `onSetStatus`:
```jsx
export default function WorkspaceHeader({
  name = 'Project Engine',
  onCompose,
  onInvite,
  onPreferences,
  onBackToApp,
  selfStatus = 'active',
  manualStatus = 'auto',
  onSetStatus,
}) {
```

Add an import for the status dot at the top:
```jsx
import PresenceDot from '../PresenceDot'
```

Inside the dropdown (`WorkspaceHeader.jsx:73-81`), insert a status section **above** the existing items so it reads first. Replace the menu body:
```jsx
      {open && (
        <div className="absolute left-2 top-12 z-50 w-60 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-elevated py-1 overflow-hidden">
          {menuItem(UserPlus, 'Invite people', onInvite)}
          {menuItem(Settings, 'Preferences', onPreferences)}
          <div className="my-1 border-t border-slate-200 dark:border-dark-border" />
          {menuItem(ArrowLeft, 'Back to Project Engine', onBackToApp)}
          {menuItem(LogOut, 'Sign out', handleSignOut)}
        </div>
      )}
```
with:
```jsx
      {open && (
        <div className="absolute left-2 top-12 z-50 w-60 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-elevated py-1 overflow-hidden">
          {onSetStatus && (
            <>
              <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Set yourself as
              </div>
              {STATUS_CHOICES.map(opt => {
                const selected = (manualStatus === 'auto' ? 'active' : manualStatus) === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setOpen(false); onSetStatus(opt.value === 'active' ? 'auto' : opt.value) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 text-left"
                  >
                    <PresenceDot status={opt.status} className="!ring-0 !w-2.5 !h-2.5 shrink-0" />
                    <span className="flex-1 truncate">{opt.label}</span>
                    {selected && <Check className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />}
                  </button>
                )
              })}
              <div className="my-1 border-t border-slate-200 dark:border-dark-border" />
            </>
          )}
          {menuItem(UserPlus, 'Invite people', onInvite)}
          {menuItem(Settings, 'Preferences', onPreferences)}
          <div className="my-1 border-t border-slate-200 dark:border-dark-border" />
          {menuItem(ArrowLeft, 'Back to Project Engine', onBackToApp)}
          {menuItem(LogOut, 'Sign out', handleSignOut)}
        </div>
      )}
```

Add `Check` to the lucide import (line 2) and define the choices near the top of the file (after imports), mirroring the rail's `STATUS_OPTIONS`:
```jsx
import { ChevronDown, PenSquare, UserPlus, Settings, ArrowLeft, LogOut, Check } from 'lucide-react'
```
```jsx
const STATUS_CHOICES = [
  { value: 'active', label: 'Active', status: 'active' },
  { value: 'away', label: 'Away', status: 'away' },
  { value: 'offline', label: 'Appear offline', status: 'offline' },
]
```

**Step 2: Pass-through in `ChannelSidebar`**

In `ChannelSidebar.jsx`, add `selfStatus`, `manualStatus`, `onSetStatus` to the props (after `onPreferences` in the destructure, ~line 75) and forward them to `<WorkspaceHeader>` (the element at `ChannelSidebar.jsx:349`):
```jsx
      <WorkspaceHeader
        onCompose={onCompose}
        onBackToApp={onBackToApp}
        onInvite={onInvite}
        onPreferences={onPreferences}
        selfStatus={selfStatus}
        manualStatus={manualStatus}
        onSetStatus={onSetStatus}
      />
```

**Step 3: Pass from `ChatPage`**

`ChatPage` already computes `selfDisplayStatus`, `myStatus`, and `onSetMyStatus` for the rail (lines 230-242). Pass them to `<ChannelSidebar>` (the element at `ChatPage.jsx:271`):
```jsx
          onPreferences={() => setPrefsOpen(true)}
          view={railActive}
          composeFocusSignal={composeFocusSignal}
          selfStatus={selfDisplayStatus}
          manualStatus={myStatus}
          onSetStatus={onSetMyStatus}
```

**Step 4: Verify**

Run: `npm run test:run` → green. `npm run build` → success.
Desktop `/chat`: open the workspace-name dropdown → a "Set yourself as" group now appears with Active/Away/Appear offline and a check on the current one; selecting one updates the rail avatar dot live (same store). Mobile: same dropdown is the only status entry point. The rail (desktop) status menu is untouched.

**Step 5: Commit**

```bash
git add src/components/chat/slack/WorkspaceHeader.jsx src/components/chat/slack/ChannelSidebar.jsx src/pages/ChatPage.jsx
git commit -m "feat(chat-mobile): status control in WorkspaceHeader dropdown (rail parity)"
```

---

### Task B3: Back chevron in `ChannelHeader` + remove the "All conversations" bar

**Files:**
- Modify: `src/components/chat/slack/ChannelHeader.jsx` (add optional `onBack`)
- Modify: `src/components/chat/slack/SlackMessagePane.jsx` (pass `onBack` through)
- Modify: `src/pages/ChatPage.jsx` (remove the bar; pass `onBack`)

**Step 1: `ChannelHeader` accepts `onBack`**

Add `onBack` to the props (after `onSearchInChannel`, ~line 95). Add `ChevronLeft` to the lucide import (line 2-6). Then, as the first child of the `h-[50px]` row (`ChannelHeader.jsx:139`, immediately inside `<div className="h-[50px] px-4 flex items-center gap-2">`), insert:
```jsx
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="md:hidden -ml-1.5 mr-0.5 w-9 h-9 shrink-0 grid place-items-center rounded-md text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
            aria-label="Back to conversations"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
        )}
```

**Step 2: `SlackMessagePane` forwards `onBack`**

Add `onBack` to the `SlackMessagePane` props (`SlackMessagePane.jsx:53-64`) and pass it to `<ChannelHeader>` (`SlackMessagePane.jsx:284`):
```jsx
          <ChannelHeader
            conversation={conversation}
            otherProfile={conversation.other_profile}
            online={online}
            status={status}
            onBack={onBack}
```

**Step 3: `ChatPage` — delete the standalone bar, pass `onBack`**

At `ChatPage.jsx:296-318`, replace the `<>...</>` that wraps the mobile back button + pane:
```jsx
        {activeConv ? (
          <>
            <button
              type="button"
              onClick={() => navigate('/chat')}
              className="md:hidden flex items-center gap-1.5 px-3 py-2 text-sm text-brand-600 dark:text-brand-400 border-b border-slate-200 dark:border-dark-border"
            >
              <ArrowLeft className="w-4 h-4" /> All conversations
            </button>
            <div className="flex-1 min-h-0 flex">
              <SlackMessagePane
                conversation={activeConv}
                online={online}
                status={peerStatus}
                onMarkRead={markRead}
                onGroupChanged={refetch}
                lastReadAt={preReadLastReadAt}
                threadRoot={threadRoot}
                onOpenThread={openThread}
                onCloseThread={closeThread}
              />
            </div>
          </>
        ) : conversationId && !loading ? (
```
with:
```jsx
        {activeConv ? (
          <div className="flex-1 min-h-0 flex">
            <SlackMessagePane
              conversation={activeConv}
              online={online}
              status={peerStatus}
              onMarkRead={markRead}
              onGroupChanged={refetch}
              lastReadAt={preReadLastReadAt}
              threadRoot={threadRoot}
              onOpenThread={openThread}
              onCloseThread={closeThread}
              onBack={() => navigate('/chat')}
            />
          </div>
        ) : conversationId && !loading ? (
```

Then remove the now-unused `ArrowLeft` import (`ChatPage.jsx:3`) if nothing else uses it (grep first):
Run: `grep -n "ArrowLeft" src/pages/ChatPage.jsx` — if the only hit is the import, drop `ArrowLeft` from the `lucide-react` import on line 3.

**Step 4: Verify**

Run: `npm run test:run` → green. `npm run build` → success.
Mobile `/chat/:id`: a back chevron sits left of the avatar/name in the header; tapping it returns to the full-width list. No separate "All conversations" strip. Desktop: header unchanged (chevron is `md:hidden`).

**Step 5: Commit**

```bash
git add src/components/chat/slack/ChannelHeader.jsx src/components/chat/slack/SlackMessagePane.jsx src/pages/ChatPage.jsx
git commit -m "feat(chat-mobile): in-header back chevron, drop standalone back bar"
```

---

### Task B4: Collapse header secondary actions into a `⋮` overflow on mobile

**Files:**
- Modify: `src/components/chat/slack/ChannelHeader.jsx`

Keep "Open task" and the member stack inline (primary/compact). Move the icon actions — search-in-conversation, set-wallpaper, start-call — and the assign-task / add-todo buttons into a kebab menu under `md`. Desktop keeps everything inline exactly as today.

**Step 1: Add overflow state + menu**

Add `MoreVertical` to the lucide import. Add local state near the top of the component body (after `const isDm = ...`, ~line 107):
```jsx
  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowRef = useRef(null)
  useEffect(() => {
    if (!overflowOpen) return
    const onDoc = (e) => { if (overflowRef.current && !overflowRef.current.contains(e.target)) setOverflowOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOverflowOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [overflowOpen])
```
Add the React imports at the top: `import { useEffect, useRef, useState } from 'react'`.

**Step 2: Gate the inline cluster to desktop, add the kebab**

Wrap the existing right-controls cluster so the *secondary* buttons are `hidden md:flex`. The simplest, low-risk approach: add `hidden md:flex` to the existing inline buttons for **search**, **wallpaper**, **call**, and the **assign-task**/**add-todo** buttons (add the class to each of those `<button>`s' className). Keep "Open task" and `MemberStack` without the gate.

Then add a mobile-only kebab as the last child of the `ml-auto` controls div (`ChannelHeader.jsx:178`):
```jsx
          {/* Mobile overflow — the secondary actions that are inline on desktop */}
          <div className="relative md:hidden" ref={overflowRef}>
            <button
              type="button"
              onClick={() => setOverflowOpen(o => !o)}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              className="w-9 h-9 grid place-items-center rounded-md text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
              aria-label="More actions"
            >
              <MoreVertical className="w-5 h-5" />
            </button>
            {overflowOpen && (
              <div role="menu" className="absolute right-0 top-10 z-30 w-52 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-elevated py-1">
                {canAssignTask && (
                  <OverflowItem icon={ClipboardList} label="Assign task" onClick={() => { setOverflowOpen(false); onAssignTask?.() }} />
                )}
                {canAddTodo && (
                  <OverflowItem icon={CheckSquare} label="Add to-do" onClick={() => { setOverflowOpen(false); onAddTodo?.() }} />
                )}
                {onSetWallpaper && (
                  <OverflowItem icon={ImageIcon} label="Set wallpaper" onClick={() => { setOverflowOpen(false); onSetWallpaper() }} />
                )}
                {onStartCall && (
                  <OverflowItem icon={Video} label="Start call" onClick={() => { setOverflowOpen(false); onStartCall() }} />
                )}
              </div>
            )}
          </div>
```

Add a small local component at the bottom of the file (next to `UrgencyDot`/`MemberStack`):
```jsx
function OverflowItem({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 text-left"
    >
      <Icon className="w-4 h-4 shrink-0 text-slate-400" />
      <span className="truncate">{label}</span>
    </button>
  )
}
```

Note: the search-in-conversation button is a disabled stub today; leave it desktop-only (`hidden md:flex`) and omit it from the overflow until a real search surface exists (don't add a dead menu item).

**Step 3: Verify**

Run: `npm run test:run` → green. `npm run build` → success.
Mobile `/chat/:id`: the header right side shows at most "Open task" (task chats) + member stack + a `⋮`; tapping `⋮` lists Assign task / Add to-do / Set wallpaper / Start call as applicable. Desktop: identical to before (kebab is `md:hidden`, inline buttons are `hidden md:flex` so they show at `md+`).

**Step 4: Commit**

```bash
git add src/components/chat/slack/ChannelHeader.jsx
git commit -m "feat(chat-mobile): collapse header secondary actions into kebab under md"
```

---

### Task B5: Batch B checkpoint (manual)

- [ ] Mobile list is full-width, no dark rail; status reachable via the workspace dropdown.
- [ ] Back chevron returns to the list; no leftover "All conversations" bar.
- [ ] Header `⋮` exposes assign-task/wallpaper/call; desktop header visually unchanged.
**Pause for review.**

---

## BATCH C — Composer declutter + safe area

After this batch the mobile composer is a clean `[+] [text] [emoji] [send]` row that doesn't trigger iOS zoom and clears the home indicator. **Stop and review before Batch D.**

### Task C1: 16px textarea on mobile (kill iOS focus-zoom)

**Files:**
- Modify: `src/components/chat/ChatComposer.jsx:657`

**Step 1: Bump the font size at mobile only**

In the `<textarea>` className (line 657), change `text-sm` → `text-base md:text-sm`:
```jsx
          className="flex-1 resize-none rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border px-3 py-2 text-base md:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
```

Why: iOS Safari auto-zooms when focus lands on an input with computed font-size < 16px. `text-base` = 16px on mobile prevents the zoom jolt; `md:text-sm` keeps the denser 14px on desktop.

**Step 2: Verify**

Run: `npm run build` → success. (Real proof is on-device in C4.)

**Step 3: Commit**

```bash
git add src/components/chat/ChatComposer.jsx
git commit -m "feat(chat-mobile): 16px composer textarea on mobile (no iOS zoom)"
```

---

### Task C2: Mobile composer action row — keep only attach/emoji/send

**Files:**
- Modify: `src/components/chat/ChatComposer.jsx`

Hide the drag-resize grip, the formatting-toggle, the `@`-mention button, and the GIF button on mobile (`hidden md:flex`). Keep attach (paperclip), emoji, textarea, send. `@` still works by typing it; formatting/GIF are desktop niceties.

**Step 1: Hide the resize grip on mobile**

At the resize handle `<div>` (`ChatComposer.jsx:561-570`), add `hidden md:flex` to its className (it currently has `flex items-center justify-center`), e.g. `... cursor-ns-resize hidden md:flex items-center justify-center group`.

**Step 2: Hide the formatting-toggle, mention, and GIF buttons on mobile**

- Formatting-toggle `<button>` (`ChatComposer.jsx:591-600`): add `hidden md:flex` to its className.
- Mention `<button>` (`ChatComposer.jsx:617-628`): add `hidden md:flex`.
- GIF `<button>` inside the `{giphyEnabled && (...)}` block (`ChatComposer.jsx:632-642`): add `hidden md:flex`.

Each of these buttons currently uses `flex items-center justify-center` — adding `hidden md:flex` keeps the desktop layout and removes them under `md`. The emoji button and paperclip stay (always visible). The `EmojiPicker`/`GifPicker` popover *components* stay mounted; only their trigger buttons hide — and GIF's trigger being hidden means the popover can't open on mobile, which is intended.

**Step 3: Verify**

Run: `npm run test:run` → green. `npm run build` → success.
Mobile: composer row shows `[paperclip] [textarea] [emoji] [send]` only. Desktop: full row (paperclip, formatting, emoji, mention, gif, textarea, send) and the resize grip unchanged.

**Step 4: Commit**

```bash
git add src/components/chat/ChatComposer.jsx
git commit -m "feat(chat-mobile): minimal composer action row under md"
```

---

### Task C3: Safe-area padding under the composer

**Files:**
- Modify: `src/components/chat/ChatComposer.jsx:477`

**Step 1: Pad the composer's outer container**

The outer wrapper at `ChatComposer.jsx:477` is `border-t border-slate-200 dark:border-dark-border ...`. Add bottom safe-area padding via an arbitrary Tailwind value:
```jsx
    <div
      className={`border-t border-slate-200 dark:border-dark-border pb-[env(safe-area-inset-bottom)] md:pb-0 ${dragOver ? 'ring-2 ring-inset ring-brand-400' : ''}`}
```

`md:pb-0` ensures desktop is untouched (no inset there anyway, but explicit).

**Step 2: Verify**

Run: `npm run build` → success. On-device proof in C4.

**Step 3: Commit**

```bash
git add src/components/chat/ChatComposer.jsx
git commit -m "feat(chat-mobile): safe-area-inset padding under composer"
```

---

### Task C4: Batch C checkpoint (manual, on-device)

- [ ] Tapping the composer does NOT zoom the page (iOS).
- [ ] Composer row is attach/text/emoji/send only on mobile.
- [ ] On a notched/home-indicator phone, the send row clears the home indicator.
- [ ] Desktop composer is unchanged (formatting/mention/gif/resize all present).
**Pause for review.**

---

## BATCH D — Touch targets + tap-to-reveal message actions

After this batch, phone users can comfortably tap rows and can react/reply/thread/delete a message. **Final batch.**

### Task D1: `chatTouch` helpers (TDD)

**Files:**
- Create: `src/lib/chatTouch.js`
- Test: `src/lib/__tests__/chatTouch.test.js`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { shouldToggleMessageActions } from '../chatTouch'

describe('shouldToggleMessageActions', () => {
  it('toggles only on coarse pointers when no interactive element was hit', () => {
    expect(shouldToggleMessageActions({ coarsePointer: true, hitInteractive: false })).toBe(true)
  })
  it('never toggles on fine pointers (desktop uses hover)', () => {
    expect(shouldToggleMessageActions({ coarsePointer: false, hitInteractive: false })).toBe(false)
  })
  it('never toggles when the tap hit a link/button/image/toolbar', () => {
    expect(shouldToggleMessageActions({ coarsePointer: true, hitInteractive: true })).toBe(false)
  })
})
```

**Step 2: Run to verify it fails**

Run: `npm run test:run -- src/lib/__tests__/chatTouch.test.js`
Expected: FAIL — cannot resolve `../chatTouch`.

**Step 3: Implement**

```js
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
```

**Step 4: Run to verify it passes**

Run: `npm run test:run -- src/lib/__tests__/chatTouch.test.js`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add src/lib/chatTouch.js src/lib/__tests__/chatTouch.test.js
git commit -m "feat(chat-mobile): chatTouch helpers (coarse pointer + tap-toggle) + tests"
```

---

### Task D2: Tap-to-reveal the message action toolbar

**Files:**
- Modify: `src/components/chat/slack/MessageRow.jsx`

On touch, tapping a message toggles its hover toolbar (`MessageRow.jsx:288`) and timestamp (`MessageRow.jsx:212`). Tapping a link/image/button inside the message does its normal thing; tapping elsewhere or another message dismisses.

**Step 1: Add active state + outside-tap dismiss**

In `MessageRow`, add near the top of the component body:
```jsx
  const rowRef = useRef(null)
  const [touchActive, setTouchActive] = useState(false)

  // Tap-to-reveal the action toolbar on touch devices (no hover there).
  const onRowClick = (e) => {
    const hitInteractive = !!e.target.closest('a, button, img, [role="button"], [data-msg-toolbar]')
    if (!shouldToggleMessageActions({ coarsePointer: isCoarsePointer(), hitInteractive })) return
    setTouchActive(v => !v)
  }

  // While active, a tap anywhere outside this row closes the toolbar.
  useEffect(() => {
    if (!touchActive) return
    const onDoc = (e) => { if (rowRef.current && !rowRef.current.contains(e.target)) setTouchActive(false) }
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [touchActive])
```
Add imports: `useEffect, useRef, useState` from React (extend the existing React import), and:
```jsx
import { isCoarsePointer, shouldToggleMessageActions } from '../../../lib/chatTouch'
```

**Step 2: Attach to the row + force-show when active**

On the row container (`MessageRow.jsx:191`, the `group/message relative flex ...` div), add `ref={rowRef}` and `onClick={onRowClick}`.

Toolbar (`MessageRow.jsx:288`): it is currently
```jsx
        <div className="hidden group-hover/message:inline-flex group-focus-within/message:inline-flex absolute -top-3 right-9 z-20 ...">
```
Change the leading `hidden` to be conditional and tag it for the interactive check:
```jsx
        <div data-msg-toolbar className={`${touchActive ? 'inline-flex' : 'hidden'} group-hover/message:inline-flex group-focus-within/message:inline-flex absolute -top-3 right-9 z-20 rounded-md border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-card p-0.5`}>
```

Timestamp (`MessageRow.jsx:212`): currently `hidden group-hover/message:block ...`. Make it also show when active:
```jsx
          <span className={`${touchActive ? 'block' : 'hidden'} group-hover/message:block absolute left-5 text-timestamp text-slate-400 leading-[22px] pt-px`}>
```

(The `data-msg-toolbar` attribute makes taps on the toolbar count as "interactive" so they trigger the buttons instead of toggling the row closed.)

**Step 3: Verify**

Run: `npm run test:run` → green. `npm run build` → success.
Mobile: tap a message → its react/reply/thread/⋮ toolbar appears; tap a reaction or reply → it works; tap another message → first closes, second opens; tap empty space → closes. Desktop: hover still reveals the toolbar exactly as before (coarse-pointer guard makes `onRowClick` a no-op on fine pointers, so clicks never toggle).

**Step 4: Commit**

```bash
git add src/components/chat/slack/MessageRow.jsx
git commit -m "feat(chat-mobile): tap-to-reveal message action toolbar on touch"
```

---

### Task D3: Sidebar rows — touch height + always-visible actions

**Files:**
- Modify: `src/components/chat/slack/SidebarRow.jsx`

**Step 1: Taller tap target on mobile**

Row container (`SidebarRow.jsx:91`) is `group/row relative h-7 w-full px-2 mx-2 ...`. Change `h-7` → `h-10 md:h-7` for a comfortable ~40px touch row on mobile (desktop density preserved).

**Step 2: Always-show star/× on touch**

The star button (`SidebarRow.jsx:146-150`) hides via `opacity-0 group-hover/row:opacity-100` when not starred. Make it visible on coarse pointers by adding `max-md:opacity-100` to the non-starred branch className. Concretely, in the className template change:
```js
            : 'text-white/50 opacity-0 group-hover/row:opacity-100'
```
to:
```js
            : 'text-white/50 opacity-0 group-hover/row:opacity-100 max-md:opacity-100'
```
The × button (`SidebarRow.jsx:162`) similarly ends with `opacity-0 group-hover/row:opacity-100 focus:opacity-100`; append `max-md:opacity-100`.

Note: the unread/mention badge hides on hover when actions are present (`group-hover/row:hidden`, `SidebarRow.jsx:132`). On touch there's no hover so the badge stays put and the always-visible star/× sit beside it — acceptable. (If it reads crowded on-device, a follow-up can swap to `max-md:hidden` on the badge when actions exist; leave as-is for now — YAGNI.)

**Step 3: Verify**

Run: `npm run test:run` → green. `npm run build` → success.
Mobile list: rows are taller and easy to tap; star/close affordances are visible without hover. Desktop: rows stay compact (`h-7`) and star/× remain hover-revealed.

**Step 4: Commit**

```bash
git add src/components/chat/slack/SidebarRow.jsx
git commit -m "feat(chat-mobile): taller sidebar rows + touch-visible row actions"
```

---

### Task D4: Final full verification

**Step 1: Tests + build**

Run: `npm run test:run`
Expected: ALL suites green (including the two new ones: `chatViewport`, `chatTouch`).
Run: `npm run build`
Expected: success, no new warnings beyond the existing baseline.

**Step 2: Desktop parity sweep (devtools, ≥ 768px)**

- [ ] `/chat` looks identical to `origin/main`: rail + resizable sidebar + 3-pane, header inline controls, full composer row + resize grip, compact hover-revealed sidebar rows, hover message toolbar.

**Step 3: Mobile device matrix (real devices — OAuth blocks headless)**

iPhone Safari + Android Chrome:
- [ ] A1–A5: composer pinned above keyboard; no page scroll leak; clean dismiss.
- [ ] B: full-width list, no rail, status via dropdown, back chevron, header `⋮`.
- [ ] C: no focus-zoom, minimal composer, safe-area clearance.
- [ ] D: tap-to-reveal message actions work end-to-end; taller, tappable sidebar rows with visible star/×.

**Step 4: Commit any device-driven tweaks**, then this branch is ready for PR.

```bash
git commit -am "fix(chat-mobile): device-test adjustments"   # only if needed
```

---

## Done criteria

- `npm run test:run` green (incl. `chatViewport`, `chatTouch`).
- `npm run build` clean.
- Desktop `/chat` visually unchanged at `md+`.
- On a real phone: keyboard-aware composer, rail-free full-width list, in-header back + overflow, status in the dropdown, 16px no-zoom composer with safe-area clearance, and tap-reachable message + row actions.
- Update `~/obsidian-vault/projects/project-engine.md` + today's daily note with the shipped result; update `MEMORY.md` pointer if a durable gotcha emerged (e.g. the iOS `offsetTop` fallback).
</content>
