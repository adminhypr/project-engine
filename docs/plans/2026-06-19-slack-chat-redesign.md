# Slack-Faithful Chat Page Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the dedicated `/chat` page into a full-viewport, Slack-faithful
experience (rail + channel sidebar + message pane + thread flexpane), using
Project Engine's indigo brand palette, and reskin the floating ChatWidget to
match — all without any database/RLS/migration changes.

**Architecture:** Pure presentation-layer rebuild. Every existing hook
(`useContactList`, `useConversation`, `useThread`, `useMessageReactions`,
`useGlobalPresence`, `useDmTyping`, …) is reused unchanged. New shell components
under `src/components/chat/slack/` consume those hooks; shared message/composer
primitives are imported by BOTH the new ChatPage and the existing ChatWidget so
the widget reskins for free. Extractable logic (message grouping, date dividers,
quick-switcher fuzzy ranking, keyboard map) lives in pure modules under
`src/lib/` with Vitest unit tests.

**Tech Stack:** React 18 + Vite, Tailwind 3 (`darkMode: 'class'`), Framer Motion,
lucide-react icons, Supabase hooks (unchanged), Vitest + RTL (logic only — no
component tests in this repo; UI verified manually via `npm run dev`).

**Design reference:** `docs/plans/2026-06-19-slack-chat-redesign-design.md`

**Conventions for the executing engineer:**
- Brand palette is **indigo** (`brand-500 #6366f1`, `brand-600 #4f46e5`). Dark
  surfaces: `dark.bg #0f1117`, `dark.surface #181a24`, `dark.card #1e2030`,
  `dark.border #2a2d3e`. These already exist in `tailwind.config.js`.
- Path alias `@` → `/src`.
- Run a single test: `npm test -- src/lib/__tests__/<name>.test.js`.
- Run all tests once: `npm run test:run`.
- Dev server (manual verification): `npm run dev` → http://localhost:5173/chat
- Commit after every green step. Branch: `complete-redesign`.
- Do NOT touch migrations, RLS, edge functions, or any `use*` data hook's
  data-fetching logic. If a hook needs a new derived field, compute it in a
  pure lib function and call it from the component, not inside the hook.

---

## Phase 0: Foundations (tokens, font, lib scaffolding)

### Task 0.1: Add Slack-mapped Tailwind tokens

**Files:**
- Modify: `tailwind.config.js` (the `theme.extend.colors` block, after `priority`)

**Step 1:** Add a `slack` color group and `fontSize` entries inside
`theme.extend`:

```js
// inside theme.extend.colors, after `priority: {...}`
slack: {
  sidebar:      '#1a1d24',
  'sidebar-2':  '#15171d',
  'item-active':'#4f46e5',   // brand-600
  presence:     '#22c55e',
  mention:      '#ef4444',
  'pane-text':  '#1d1c1d',
},
```

```js
// add a new key inside theme.extend (sibling of colors)
fontSize: {
  msg:          ['15px', { lineHeight: '22px' }],
  'sidebar-hdr':['13px', { lineHeight: '18px' }],
  timestamp:    ['12px', { lineHeight: '18px' }],
  'channel-hdr':['18px', { lineHeight: '24px' }],
},
```

**Step 2:** Verify build does not break.
Run: `npm run build`
Expected: build succeeds (no Tailwind config error).

**Step 3:** Commit.
```bash
git add tailwind.config.js
git commit -m "feat(chat): add slack-mapped tailwind tokens"
```

### Task 0.2: Self-host Lato font, scoped to the chat shell

**Files:**
- Modify: `src/index.css` (add `@font-face` or `@import`, plus a `.slack-chat` scope class)

**Step 1:** Add Lato via Google Fonts `@import` at the very top of
`src/index.css` (above the `@tailwind` directives is invalid — put the
`@import` as the FIRST line, before `@tailwind base`):

```css
@import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&display=swap');
```

Then near the bottom add a scope class so Lato only applies inside the chat
shell (avoids restyling the rest of the app):

```css
.slack-chat,
.slack-chat * {
  font-family: Lato, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
    Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';
}
```

**Step 2:** Verify dev server renders and the import resolves (no console 404
for the font in normal conditions).
Run: `npm run dev`, open `/chat` after Phase 1 lands; for now just confirm
`npm run build` succeeds.
Run: `npm run build`
Expected: success.

**Step 3:** Commit.
```bash
git add src/index.css
git commit -m "feat(chat): self-host Lato for the chat shell"
```

---

## Phase 1: Shell — rail, sidebar, takeover layout

### Task 1.1: Pure message-grouping helper (TDD)

This is the single most important "feels like Slack" function and is pure logic
— so it gets a real test.

**Files:**
- Create: `src/lib/messageGrouping.js`
- Test: `src/lib/__tests__/messageGrouping.test.js`

**Step 1: Write the failing test.**

```js
import { describe, it, expect } from 'vitest';
import { isLeadMessage, groupGapMs } from '@/lib/messageGrouping';

const m = (author_id, created_at) => ({ author_id, created_at });

describe('isLeadMessage', () => {
  it('is a lead when there is no previous message', () => {
    expect(isLeadMessage(m('a', '2026-06-19T10:00:00Z'), null)).toBe(true);
  });
  it('is a lead when the author changes', () => {
    const prev = m('a', '2026-06-19T10:00:00Z');
    const cur  = m('b', '2026-06-19T10:00:30Z');
    expect(isLeadMessage(cur, prev)).toBe(true);
  });
  it('is NOT a lead for same author within the gap window', () => {
    const prev = m('a', '2026-06-19T10:00:00Z');
    const cur  = m('a', '2026-06-19T10:02:00Z'); // 2 min
    expect(isLeadMessage(cur, prev)).toBe(false);
  });
  it('is a lead for same author after the gap window (>5min)', () => {
    const prev = m('a', '2026-06-19T10:00:00Z');
    const cur  = m('a', '2026-06-19T10:06:00Z'); // 6 min
    expect(isLeadMessage(cur, prev)).toBe(true);
  });
  it('is a lead when the calendar day changes', () => {
    const prev = m('a', '2026-06-19T23:59:00Z');
    const cur  = m('a', '2026-06-20T00:00:30Z');
    expect(isLeadMessage(cur, prev)).toBe(true);
  });
  it('exposes the gap window constant', () => {
    expect(groupGapMs).toBe(5 * 60 * 1000);
  });
});
```

**Step 2: Run test to verify it fails.**
Run: `npm test -- src/lib/__tests__/messageGrouping.test.js`
Expected: FAIL ("does not provide an export named 'isLeadMessage'").

**Step 3: Write minimal implementation.**

```js
// src/lib/messageGrouping.js
export const groupGapMs = 5 * 60 * 1000;

function sameDay(a, b) {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

export function isLeadMessage(cur, prev) {
  if (!prev) return true;
  if (cur.author_id !== prev.author_id) return true;
  if (!sameDay(prev.created_at, cur.created_at)) return true;
  return (new Date(cur.created_at) - new Date(prev.created_at)) > groupGapMs;
}
```

**Step 4: Run test to verify it passes.**
Run: `npm test -- src/lib/__tests__/messageGrouping.test.js`
Expected: PASS (6 tests).

**Step 5: Commit.**
```bash
git add src/lib/messageGrouping.js src/lib/__tests__/messageGrouping.test.js
git commit -m "feat(chat): message grouping helper with tests"
```

### Task 1.2: Date-divider + new-messages helpers (TDD)

**Files:**
- Create: `src/lib/messageDividers.js`
- Test: `src/lib/__tests__/messageDividers.test.js`

**Step 1: Write the failing test.**

```js
import { describe, it, expect } from 'vitest';
import { dividerLabel, firstUnreadId } from '@/lib/messageDividers';

describe('dividerLabel', () => {
  const today = new Date('2026-06-19T12:00:00Z');
  it('labels today', () => {
    expect(dividerLabel('2026-06-19T08:00:00Z', today)).toBe('Today');
  });
  it('labels yesterday', () => {
    expect(dividerLabel('2026-06-18T08:00:00Z', today)).toBe('Yesterday');
  });
  it('labels an older date with a month/day string', () => {
    expect(dividerLabel('2026-06-12T08:00:00Z', today)).toMatch(/June 12/);
  });
});

describe('firstUnreadId', () => {
  const msgs = [
    { id: '1', created_at: '2026-06-19T10:00:00Z' },
    { id: '2', created_at: '2026-06-19T11:00:00Z' },
    { id: '3', created_at: '2026-06-19T12:00:00Z' },
  ];
  it('returns the first message created after last_read_at', () => {
    expect(firstUnreadId(msgs, '2026-06-19T10:30:00Z')).toBe('2');
  });
  it('returns null when everything is read', () => {
    expect(firstUnreadId(msgs, '2026-06-19T23:00:00Z')).toBe(null);
  });
  it('returns null when last_read_at is missing', () => {
    expect(firstUnreadId(msgs, null)).toBe(null);
  });
});
```

**Step 2: Run — expect FAIL.**
Run: `npm test -- src/lib/__tests__/messageDividers.test.js`

**Step 3: Implement.**

```js
// src/lib/messageDividers.js
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function dividerLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (sameDay(d, now)) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

export function firstUnreadId(messages, lastReadAt) {
  if (!lastReadAt) return null;
  const cut = new Date(lastReadAt);
  const hit = messages.find(m => new Date(m.created_at) > cut);
  return hit ? hit.id : null;
}
```

**Step 4: Run — expect PASS.**
**Step 5: Commit.**
```bash
git add src/lib/messageDividers.js src/lib/__tests__/messageDividers.test.js
git commit -m "feat(chat): date divider + first-unread helpers with tests"
```

### Task 1.3: Sidebar taxonomy mapping helper (TDD)

Maps the existing `useContactList` output (sections/groups/campfires/tasks) into
Slack's Channels / Direct messages / Task chats buckets.

**Files:**
- Create: `src/lib/slackSidebar.js`
- Test: `src/lib/__tests__/slackSidebar.test.js`

**Step 1: Failing test.**

```js
import { describe, it, expect } from 'vitest';
import { buildSidebarSections } from '@/lib/slackSidebar';

it('maps campfires + groups into Channels and 1:1s into Direct messages', () => {
  const input = {
    sections: { recent: [], teammates: [{ conversationId: 'd1', kind: 'dm', name: 'Marie' }], company: [] },
    groups:   [{ id: 'g1', kind: 'group', title: 'Ops' }],
    campfires:[{ id: 'c1', kind: 'hub', title: 'Systems Dev' }],
    tasks:    [{ id: 't1', kind: 'task', task_title: 'Fix login' }],
  };
  const out = buildSidebarSections(input);
  expect(out.channels.map(c => c.id)).toEqual(['c1', 'g1']);   // campfires first, then groups
  expect(out.directMessages.map(d => d.name)).toContain('Marie');
  expect(out.taskChats.map(t => t.id)).toEqual(['t1']);
});

it('returns empty arrays for missing input safely', () => {
  const out = buildSidebarSections({});
  expect(out.channels).toEqual([]);
  expect(out.directMessages).toEqual([]);
  expect(out.taskChats).toEqual([]);
});
```

**Step 2: Run — FAIL. Step 3: Implement** (campfires before groups under
Channels; flatten recent+teammates+company for DMs, dedup by conversationId):

```js
// src/lib/slackSidebar.js
export function buildSidebarSections(input = {}) {
  const { sections = {}, groups = [], campfires = [], tasks = [] } = input;
  const dmRaw = [
    ...(sections.recent || []),
    ...(sections.teammates || []),
    ...(sections.company || []),
  ];
  const seen = new Set();
  const directMessages = dmRaw.filter(c => {
    const k = c.conversationId || c.id;
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
  return {
    channels: [...campfires, ...groups],
    directMessages,
    taskChats: tasks,
  };
}
```

**Step 4: Run — PASS. Step 5: Commit.**
```bash
git add src/lib/slackSidebar.js src/lib/__tests__/slackSidebar.test.js
git commit -m "feat(chat): sidebar taxonomy mapping helper with tests"
```

> NOTE for engineer: confirm the exact shape of `useContactList`'s `sections`
> entries by reading `src/hooks/useContactList.js` and
> `src/components/chat/ContactRow.jsx` before wiring; adapt the property names
> (`conversationId`, `name`, `kind`) in the helper + test to match reality. The
> helper must mirror the real shape, not the illustrative one above.

### Task 1.4: WorkspaceRail component (manual verify)

**Files:**
- Create: `src/components/chat/slack/WorkspaceRail.jsx`

**Step 1: Implement.** A 68px-wide fixed dark rail. Props:
`{ active, onSelect, profile, presenceOnline, onBackToApp }`.
- Top: workspace icon (rounded-square, the PE logo or initials).
- Nav buttons (lucide icons + label beneath, ~11px): Home (`Home`), DMs
  (`MessageSquare`), Activity (`Bell`), Later (`Bookmark`), More (`MoreHorizontal`).
  Active item: `text-white` + subtle `bg-white/10 rounded-lg`; inactive
  `text-white/60 hover:bg-white/5`.
- A `+` create button.
- Bottom: user avatar (36px rounded-lg) with a presence dot, and a small
  "← App" button calling `onBackToApp` (navigates to `/my-tasks`).
- Container: `bg-slack-sidebar-2 w-[68px] h-full flex flex-col items-center
  py-3 gap-1`.

Use the existing `PresenceDot` component if compatible; otherwise a simple
`<span>` dot.

**Step 2: Manual verify** deferred until Task 1.6 mounts the shell. For now:
Run: `npm run build`
Expected: success (no import/JSX errors).

**Step 3: Commit.**
```bash
git add src/components/chat/slack/WorkspaceRail.jsx
git commit -m "feat(chat): WorkspaceRail component"
```

### Task 1.5: ChannelSidebar + sections + rows (manual verify)

**Files:**
- Create: `src/components/chat/slack/ChannelSidebar.jsx`
- Create: `src/components/chat/slack/SidebarSection.jsx`
- Create: `src/components/chat/slack/SidebarRow.jsx`
- Create: `src/components/chat/slack/WorkspaceHeader.jsx`

**Step 1: Implement.**
- `WorkspaceHeader`: row ~48px, workspace name 18px/900 white + `ChevronDown`,
  opens a dropdown (Invite people, Preferences, "← Back to Project Engine",
  Sign out — reuse existing auth signOut). A compose `PenSquare` icon on the right.
- `SidebarSection`: `{ title, defaultOpen, children }`. Title row 13px/700
  title-case muted, `ChevronDown`/`ChevronRight` toggle, collapse state in
  local `useState` (persist to `localStorage` key
  `pe-slack-sec-{title}` — optional, simple).
- `SidebarRow`: `{ icon, label, presence, unread, mentionCount, active, onClick }`.
  - `#` prefix or presence dot in the icon slot.
  - Read: `text-white/60 text-[15px]`; unread: `text-white font-bold`.
  - Active: `bg-slack-item-active text-white`; hover `hover:bg-white/[0.06]`.
  - Mention badge: `ml-auto min-w-[18px] h-[18px] px-1.5 rounded-full
    bg-slack-mention text-white text-[12px] font-bold grid place-items-center`.
  - Row: `h-7 px-2 mx-1 rounded-md flex items-center gap-2 cursor-pointer`.
- `ChannelSidebar`: consumes `useContactList(query)` + `buildSidebarSections`,
  renders search input, then sections: **Threads** (placeholder/optional),
  **Channels**, **Direct messages**, **Task chats**, **Apps** (optional/empty).
  Width `w-[260px]`, `bg-slack-sidebar`. Selecting a row calls
  `onSelectConversation(id)`.

Reuse `useContactList`, `createOrOpen`, presence map exactly as `ChatSidebar.jsx`
does today — read that file first to copy the wiring.

**Step 2: Manual verify** deferred to 1.6. Run `npm run build` → success.

**Step 3: Commit.**
```bash
git add src/components/chat/slack/
git commit -m "feat(chat): ChannelSidebar with Slack-style sections + rows"
```

### Task 1.6: New ChatPage shell with full-viewport takeover (manual verify)

**Files:**
- Modify: `src/pages/ChatPage.jsx` (rebuild layout; keep the existing
  conversation-restore + URL-param logic — read current file first and preserve it)
- Modify: `src/App.jsx` (ensure `/chat` route renders OUTSIDE the normal
  `Layout` chrome so the takeover is real — verify how `Layout` wraps routes;
  if `Layout` is applied per-route, render `ChatPage` without it)

**Step 1: Implement.**
- Wrap the page root in a `div.slack-chat` with
  `h-screen w-screen flex overflow-hidden bg-slack-sidebar`.
- Compose: `<WorkspaceRail/>` + `<ChannelSidebar/>` + `<MessagePane/>` (the
  message pane is restyled in Phase 2 — for now reuse the existing
  `ConversationPane` so the page is functional end-to-end after Phase 1).
- Preserve existing behavior: URL `:conversationId`, last-opened restore,
  thread reset on conversation change.
- `onBackToApp` → `navigate('/my-tasks')`.
- Ensure the global `ChatWidget` stays hidden on `/chat` (already handled by
  `onChatPage` check in `App.jsx` — verify it still triggers).

**Step 2: Manual verify (FIRST real visual check).**
Run: `npm run dev` → open http://localhost:5173/chat
Expected/confirm:
- Full-viewport: no app top/side nav visible.
- Dark rail (68px) on the far left with Home/DMs/Activity/Later/More + avatar.
- Dark channel sidebar (260px) with workspace header, search, and the
  Channels / Direct messages / Task chats sections populated from real data.
- Clicking a conversation opens it in the (still-old-styled) pane and messages
  load. Selecting reflects an active highlight in the sidebar.
- Toggle dark/light (existing theme toggle): sidebar stays dark; pane flips.
- "← App" returns to `/my-tasks`.

Fix any layout/scroll issues before committing.

**Step 3: Commit.**
```bash
git add src/pages/ChatPage.jsx src/App.jsx
git commit -m "feat(chat): full-viewport Slack takeover shell on /chat"
```

---

## Phase 2: Message pane — grouping, hover toolbar, dividers

### Task 2.1: MessageRow primitive (lead vs follow-up, hover toolbar) (manual verify)

**Files:**
- Create: `src/components/chat/slack/MessageRow.jsx`
- (Reference, do not rewrite logic: `src/components/chat/DmChatMessage.jsx`,
  `src/components/ui/RichContentRenderer.jsx`, `src/components/chat/MessageReactions.jsx`)

**Step 1: Implement.** Props mirror what `DmChatMessage` receives plus
`{ isLead }`. Render:
- Container `group/message relative flex py-1 pl-5 pr-10 hover:bg-slate-50
  dark:hover:bg-white/5`.
- Lead: 36px `rounded-lg` avatar + name (15px/700) + timestamp (12px muted) +
  body. Follow-up: empty 36px gutter; show a hover-only left timestamp
  (`hidden group-hover/message:block absolute left-5 text-timestamp text-slate-400`).
- Body via existing `RichContentRenderer` (reuse — do not reimplement markdown,
  mentions, inline images).
- @mention-you highlight: when the current user is in `msg.mentions`, add
  `border-l-2 border-amber-400 bg-amber-400/10` to the row.
- Reaction pills via existing `MessageReactions` (your reaction → brand-indigo
  fill; pass a prop or wrap to override the highlight color).
- Thread footer: reuse existing thread-count rendering (participant avatars +
  "N replies" + "last reply …") → calls `onOpenThread`.
- **Hover toolbar:** `hidden group-hover/message:inline-flex absolute -top-3
  right-9 z-20 rounded-md border bg-white dark:bg-dark-card shadow-card p-0.5`
  with buttons: quick-react (emoji), add-reaction (opens existing
  `ReactionPicker`), reply-in-thread, overflow `⋯` (copy link, mark unread,
  edit/delete-if-mine). Wire react/reply to existing handlers.

Keep system/call/deleted message variants working (copy those branches from
`DmChatMessage.jsx`).

**Step 2: Manual verify** after Task 2.2 swaps it into the list.

**Step 3: Commit.**
```bash
git add src/components/chat/slack/MessageRow.jsx
git commit -m "feat(chat): Slack-style MessageRow with hover toolbar"
```

### Task 2.2: MessageList — grouping, sticky dividers, new-messages line, jump-to-bottom (manual verify)

**Files:**
- Create: `src/components/chat/slack/SlackMessageList.jsx`
- (Reference: existing `src/components/chat/MessageList.jsx` for scroll/pagination wiring)

**Step 1: Implement.** Consume the same props the current `MessageList` gets
(messages, loadMore, hasMore, …). For each message compute `isLead` via
`isLeadMessage(msg, prev)` and render `<MessageRow isLead=...>`.
- Insert a **sticky date divider** (`sticky top-2 z-30`, centered pill on a
  hairline) before the first message of each calendar day, label via
  `dividerLabel`.
- Insert the **"New messages"** rule (`border-amber-400` rule + right-aligned
  bold label) before `firstUnreadId(messages, lastReadAt)` (lastReadAt from the
  conversation participant — read how the current code obtains it).
- **Jump-to-bottom:** track scroll position; when not at bottom show a floating
  pill `absolute bottom-24 right-6 rounded-full shadow-elevated` with an
  optional unread count; click scrolls to latest.
- Preserve existing pagination (load older on scroll-to-top) and
  scroll-to-message deep-link behavior (`pe-chat-scroll-to-message` event).

**Step 2: Manual verify.**
Run: `npm run dev` → `/chat`, open a busy conversation.
Confirm: consecutive same-author messages collapse (one avatar/name, tight
follow-ups); hovering a follow-up reveals its timestamp; date dividers show and
stick on scroll; the "New messages" line appears at the right spot after
re-opening a conversation with unread; jump-to-bottom pill appears when scrolled
up and works; reactions + threads still function; @mentions of you are amber.

**Step 3: Commit.**
```bash
git add src/components/chat/slack/SlackMessageList.jsx
git commit -m "feat(chat): grouped message list with dividers + jump-to-bottom"
```

### Task 2.3: ChannelHeader (manual verify)

**Files:**
- Create: `src/components/chat/slack/ChannelHeader.jsx`
- (Reference: `src/components/chat/ConversationHeader.jsx`)

**Step 1: Implement.** ~50px bar, bottom hairline. Leading icon (`#` for
channels/campfires/groups, avatar for DMs) + bold 18px name + caret. Tab row
(**Messages** active underline; **Files** if attachments exist — optional). Right
controls: member avatar stack + count (for groups/channels), search-in-channel
icon, details/kebab. Wire the call button if `VITE_CALLS_ENABLED` (preserve
existing behavior from `ConversationHeader`).

**Step 2: Manual verify** in the assembled pane (Task 2.4).

**Step 3: Commit.**
```bash
git add src/components/chat/slack/ChannelHeader.jsx
git commit -m "feat(chat): Slack-style ChannelHeader"
```

### Task 2.4: Assemble SlackMessagePane and wire into ChatPage (manual verify)

**Files:**
- Create: `src/components/chat/slack/SlackMessagePane.jsx`
- Modify: `src/pages/ChatPage.jsx` (replace the interim `ConversationPane` with
  `SlackMessagePane`)

**Step 1: Implement.** Compose `ChannelHeader` + `SlackMessageList` +
(existing) composer + (existing) `ThreadPanel`, consuming `useConversation`,
`useDmTyping`, `useThread` exactly as the current `ConversationPane` does — read
that file and replicate the hook wiring; only the presentation changes.

**Step 2: Manual verify.**
Run: `npm run dev` → `/chat`.
Confirm full pane works: header, grouped messages, composer sends, thread opens
in the right panel and pushes the pane, typing indicator shows.

**Step 3: Commit.**
```bash
git add src/components/chat/slack/SlackMessagePane.jsx src/pages/ChatPage.jsx
git commit -m "feat(chat): assemble Slack message pane into /chat"
```

---

## Phase 3: Composer & threads polish

### Task 3.1: Formatting toolbar additions (TDD for the markdown insert helper)

The composer already supports `**bold**`, `_italic_`, `[link](url)`. Add
strikethrough, ordered/unordered list, blockquote, inline code, code block as
text-insertion helpers.

**Files:**
- Create: `src/lib/composerFormat.js`
- Test: `src/lib/__tests__/composerFormat.test.js`
- Modify: `src/components/chat/ChatComposer.jsx` (add the toolbar buttons that
  call these helpers; reuse its existing selection-wrapping approach — read it first)

**Step 1: Failing test.**

```js
import { describe, it, expect } from 'vitest';
import { wrapSelection, prefixLines } from '@/lib/composerFormat';

describe('wrapSelection', () => {
  it('wraps the selected range with the given marker', () => {
    const r = wrapSelection('hello world', 0, 5, '~');
    expect(r.text).toBe('~hello~ world');
    expect(r.selStart).toBe(1);
    expect(r.selEnd).toBe(6);
  });
});

describe('prefixLines', () => {
  it('prefixes every selected line (blockquote)', () => {
    const r = prefixLines('a\nb', 0, 3, '> ');
    expect(r.text).toBe('> a\n> b');
  });
  it('numbers ordered lists', () => {
    const r = prefixLines('a\nb', 0, 3, (i) => `${i + 1}. `);
    expect(r.text).toBe('1. a\n2. b');
  });
});
```

**Step 2: Run — FAIL. Step 3: Implement.**

```js
// src/lib/composerFormat.js
export function wrapSelection(text, start, end, marker) {
  const sel = text.slice(start, end);
  const out = text.slice(0, start) + marker + sel + marker + text.slice(end);
  return { text: out, selStart: start + marker.length, selEnd: end + marker.length };
}

export function prefixLines(text, start, end, prefix) {
  const before = text.slice(0, start);
  const region = text.slice(start, end);
  const after  = text.slice(end);
  const lines = region.split('\n').map((ln, i) =>
    (typeof prefix === 'function' ? prefix(i) : prefix) + ln);
  const out = before + lines.join('\n') + after;
  return { text: out, selStart: start, selEnd: before.length + lines.join('\n').length };
}
```

**Step 4: Run — PASS.**
**Step 5:** Add toolbar buttons (lucide: `Bold`, `Italic`, `Strikethrough`,
`Link`, `ListOrdered`, `List`, `Quote`, `Code`, `SquareCode`) to
`ChatComposer.jsx`, each calling the helper against the textarea selection and
writing back value + caret. Group with thin dividers. Add an "Aa" toggle to
show/hide the bar. Manual verify in dev: each button transforms selected text.

**Step 6: Commit.**
```bash
git add src/lib/composerFormat.js src/lib/__tests__/composerFormat.test.js src/components/chat/ChatComposer.jsx
git commit -m "feat(chat): composer formatting toolbar (strike/lists/quote/code)"
```

### Task 3.2: Thread flexpane restyle + typing indicator (manual verify)

**Files:**
- Modify: `src/components/chat/ThreadPanel.jsx` (restyle only; keep `useThread` wiring)
- Modify: `src/components/chat/TypingIndicator.jsx` (Slack-style thin animated line)

**Step 1: Implement.** ThreadPanel: ~380px, pushes the pane (already the layout
in Phase 1/2 — ensure flex, not absolute overlay, on desktop). Slack header
"Thread" + channel name; root message at top with a divider; replies grouped
the same way (reuse `MessageRow` + grouping). TypingIndicator: thin row above
composer, animated three-dot ellipsis, "X is typing…" / "Several people are
typing…".

**Step 2: Manual verify** in dev: open a thread → panel pushes the pane;
replies render grouped; typing indicator animates while the other side types.

**Step 3: Commit.**
```bash
git add src/components/chat/ThreadPanel.jsx src/components/chat/TypingIndicator.jsx
git commit -m "feat(chat): restyle thread flexpane + typing indicator"
```

---

## Phase 4: Quick switcher + keyboard shortcuts

### Task 4.1: Fuzzy ranking helper (TDD)

**Files:**
- Create: `src/lib/fuzzyMatch.js`
- Test: `src/lib/__tests__/fuzzyMatch.test.js`

**Step 1: Failing test.**

```js
import { describe, it, expect } from 'vitest';
import { fuzzyScore, fuzzyFilter } from '@/lib/fuzzyMatch';

describe('fuzzyScore', () => {
  it('returns >0 for a subsequence match', () => {
    expect(fuzzyScore('mre', 'Marie Anne')).toBeGreaterThan(0);
  });
  it('returns 0 when not a subsequence', () => {
    expect(fuzzyScore('xyz', 'Marie')).toBe(0);
  });
  it('scores a contiguous prefix higher than a scattered match', () => {
    expect(fuzzyScore('mar', 'Marie')).toBeGreaterThan(fuzzyScore('mre', 'Marie Anne'));
  });
  it('is case-insensitive', () => {
    expect(fuzzyScore('MAR', 'marie')).toBeGreaterThan(0);
  });
});

describe('fuzzyFilter', () => {
  const items = [
    { id: '1', label: 'Marie Anne' },
    { id: '2', label: 'Systems Dev' },
    { id: '3', label: 'Mark Rivera' },
  ];
  it('returns matches sorted by score desc', () => {
    const r = fuzzyFilter('mar', items, x => x.label);
    expect(r[0].id).toBe('1'); // "Mar" prefix beats scattered
  });
  it('returns all items for an empty query', () => {
    expect(fuzzyFilter('', items, x => x.label)).toHaveLength(3);
  });
});
```

**Step 2: Run — FAIL. Step 3: Implement** a simple subsequence scorer
(contiguous + prefix bonuses):

```js
// src/lib/fuzzyMatch.js
export function fuzzyScore(query, target) {
  const q = (query || '').toLowerCase();
  const t = (target || '').toLowerCase();
  if (!q) return 1;
  let ti = 0, score = 0, streak = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (let j = ti; j < t.length; j++) { if (t[j] === ch) { found = j; break; } }
    if (found === -1) return 0;
    if (found === ti) { streak++; score += 2 + streak; } else { streak = 0; score += 1; }
    if (found === 0) score += 3; // prefix bonus
    ti = found + 1;
  }
  return score;
}

export function fuzzyFilter(query, items, getText) {
  if (!query) return items;
  return items
    .map(it => ({ it, s: fuzzyScore(query, getText(it)) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.it);
}
```

**Step 4: Run — PASS. Step 5: Commit.**
```bash
git add src/lib/fuzzyMatch.js src/lib/__tests__/fuzzyMatch.test.js
git commit -m "feat(chat): fuzzy match helper for quick switcher with tests"
```

### Task 4.2: QuickSwitcher modal (Cmd/Ctrl+K) (manual verify)

**Files:**
- Create: `src/components/chat/slack/QuickSwitcher.jsx`
- Modify: `src/pages/ChatPage.jsx` (mount it; global key listener)

**Step 1: Implement.** A centered modal (reuse `ModalWrapper` from
`ui/animations.jsx`). Input at top; below, a `fuzzyFilter`ed list of all
conversations (channels + DMs + tasks) built from `useContactList`. Arrow keys
move selection, Enter navigates to `/chat/:id`, Esc closes. Open on
`Cmd/Ctrl+K`. Each row: icon + label + small kind tag.

**Step 2: Manual verify.**
Run: `npm run dev` → `/chat`. Press `Cmd+K` (mac) / `Ctrl+K` (win): modal opens,
typing filters fuzzily, ↑/↓ move, Enter switches conversation, Esc closes.

**Step 3: Commit.**
```bash
git add src/components/chat/slack/QuickSwitcher.jsx src/pages/ChatPage.jsx
git commit -m "feat(chat): Cmd+K quick switcher"
```

### Task 4.3: Keyboard shortcut map (TDD) + wiring

**Files:**
- Create: `src/lib/chatShortcuts.js`
- Test: `src/lib/__tests__/chatShortcuts.test.js`
- Modify: `src/pages/ChatPage.jsx` (attach a keydown handler using the map)

**Step 1: Failing test.**

```js
import { describe, it, expect } from 'vitest';
import { matchShortcut } from '@/lib/chatShortcuts';

const ev = (o) => ({ key: '', metaKey: false, ctrlKey: false, shiftKey: false, ...o });

it('matches Cmd/Ctrl+K to quickSwitcher', () => {
  expect(matchShortcut(ev({ key: 'k', metaKey: true }))).toBe('quickSwitcher');
  expect(matchShortcut(ev({ key: 'k', ctrlKey: true }))).toBe('quickSwitcher');
});
it('matches Escape to closePanel', () => {
  expect(matchShortcut(ev({ key: 'Escape' }))).toBe('closePanel');
});
it('returns null for unmapped keys', () => {
  expect(matchShortcut(ev({ key: 'a' }))).toBe(null);
});
```

**Step 2: Run — FAIL. Step 3: Implement.**

```js
// src/lib/chatShortcuts.js
export function matchShortcut(e) {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'k') return 'quickSwitcher';
  if (e.key === 'Escape') return 'closePanel';
  return null;
}
```

**Step 4: Run — PASS. Step 5:** Wire in `ChatPage.jsx`: a `keydown` listener
calls `matchShortcut` and dispatches (open switcher / close thread+switcher).
Manual verify in dev.
**Step 6: Commit.**
```bash
git add src/lib/chatShortcuts.js src/lib/__tests__/chatShortcuts.test.js src/pages/ChatPage.jsx
git commit -m "feat(chat): chat keyboard shortcut map + wiring"
```

---

## Phase 5: Widget reskin

### Task 5.1: Point ChatWidget at the shared MessageRow + composer (manual verify)

**Files:**
- Modify: `src/components/chat/ConversationPane.jsx` (used by the widget) to
  render `slack/MessageRow` via `SlackMessageList`, and the formatting-enhanced
  composer.

**Step 1: Implement.** The widget's `ConversationPane` already centralizes
message + composer rendering. Swap its message list for `SlackMessageList` and
ensure the composer uses the enhanced `ChatComposer`. Keep the widget's
multi-pane/minimize/maximize behavior intact (do not touch `ChatWidget.jsx`
state logic).

**Step 2: Manual verify.**
Run: `npm run dev` → navigate to a non-chat page (e.g. `/my-tasks`); open the
floating widget; confirm messages now render grouped with the new look,
reactions/threads work, composer formatting bar is present, and minimize/
maximize/multi-pane still work.

**Step 3: Commit.**
```bash
git add src/components/chat/ConversationPane.jsx
git commit -m "feat(chat): reskin floating widget via shared Slack primitives"
```

### Task 5.2: Full regression pass + cleanup (manual verify)

**Files:** none new; delete any now-dead components only if unreferenced.

**Step 1:** Run the full test suite.
Run: `npm run test:run`
Expected: all pass (existing + new helper tests).

**Step 2:** Manual regression checklist (dev):
- `/chat` desktop: rail, sidebar sections, grouped pane, threads, switcher,
  shortcuts, dark/light.
- `/chat` mobile width (resize browser): single-pane behavior preserved.
- Floating widget on other pages: reskinned, multi-pane intact.
- Deep links (`/chat/:id`, `?dm=&message=`) still scroll to the message.
- Externals (Agent/Client) still see only permitted conversations (no
  regression — taxonomy helper must not leak; verify with an external account
  if available, else confirm `useContactList` still gates).
- Send/receive realtime, reactions realtime, typing, presence dots, unread
  badges, mention notifications.

**Step 3:** Build.
Run: `npm run build`
Expected: success.

**Step 4: Commit** any cleanup.
```bash
git add -A
git commit -m "chore(chat): regression cleanup after Slack redesign"
```

---

## Verification Summary

- **Automated (Vitest):** `messageGrouping`, `messageDividers`, `slackSidebar`,
  `composerFormat`, `fuzzyMatch`, `chatShortcuts`. Run `npm run test:run`.
- **Manual (npm run dev):** every visual/interaction task has an explicit
  checklist above — there are no component tests in this repo by design.
- **No DB/RLS/edge-function changes** were made; if any task seems to require
  one, STOP and revisit the design's "Future" section instead.

## Future Work (needs DB — not in this plan)

Pinned messages, Saved/"Later", custom status, channel topic, message editing
(`edited_at`). See the design doc's Future section. The rail's "Later" tab ships
as a placeholder until the saved-items table exists.
