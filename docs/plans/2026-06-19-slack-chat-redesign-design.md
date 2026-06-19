# Slack-Faithful Chat Page Redesign — Design

**Date:** 2026-06-19
**Branch:** `complete-redesign`
**Status:** Design locked; implementation plan to follow

## Goal

Redesign the dedicated `/chat` page into a faithful Slack experience — a true
Slack replacement for the team. Match Slack's layout, density, typography,
message grouping, hover toolbar, threads, and sidebar feel exactly, using
Project Engine's own brand palette. The reference is the team's real Slack
workspace ("Hypr Service").

This is a **presentation-layer rebuild**. The entire data layer is untouched:
every hook (`useContactList`, `useConversation`, `useThread`,
`useMessageReactions`, `useGlobalPresence`, …), every migration, and all RLS
stay exactly as-is. No schema changes are required for anything in scope.

## Locked Decisions

| Decision | Choice |
|----------|--------|
| Widget | **Keep** the floating ChatWidget, but **restyle** it to share the new visual language (via shared primitives). |
| Page chrome | **Full Slack takeover** on `/chat` — app's normal nav hidden; a "← back to Project Engine" affordance returns. |
| Visual fidelity | **Slack's UX/layout/density exactly; Project Engine brand palette** (indigo `brand-*`), full dark-mode support. |
| Sidebar taxonomy | **Channels** = groups + hub campfires (`#` prefix). **Direct messages** = 1:1s + small ad-hoc groups. **Task chats** = own collapsible section. |
| Send / accent color | **Brand indigo** (`brand-500/600`) for the send button and "your reaction" accent (not Slack green) — stays on-brand. |
| Font | Ship **Lato** (Slack's real UI font) self-hosted, system fallback. Two weights: 400 / 700. |

Build-now Slack features (all pure frontend, **no DB**):
- **Cmd/Ctrl+K quick switcher** (fuzzy jump-to-conversation).
- **Message grouping + hover toolbar.**
- **Date dividers + "New messages" line + jump-to-bottom.**
- **Rich formatting toolbar + keyboard shortcuts.**

## Shell Architecture

Full-viewport four-zone horizontal stack (Slack's Dec-2023 shell):

```
┌──────┬───────────────────┬────────────────────────────┬─────────────┐
│ Rail │  Channel sidebar  │     Message pane            │ Thread /    │
│ ~68px│  ~260px (resize)  │     flex-1                  │ profile     │
│      │                   │                             │ flexpane    │
│ Home │ Workspace ▾       │ # channel header  [tabs]    │ ~380px      │
│ DMs  │ ─ Threads         │ ───────────────────────────│ (pushes,    │
│ Activ│ ─ Channels        │  message list (grouped)     │  not        │
│ Later│   # general       │  · sticky date dividers     │  overlay)   │
│ More │ ─ Direct messages │  · hover toolbar            │             │
│      │   • Marie ●       │  · reaction pills           │             │
│ ◉ me │ ─ Task chats      │ ───────────────────────────│             │
│ ←app │ ─ Apps            │  composer + format bar      │             │
└──────┴───────────────────┴────────────────────────────┴─────────────┘
```

- **Rail (A, ~68px, fixed):** workspace icon, Home / DMs / Activity / Later /
  More, a Create `+`, and the user avatar + presence pinned bottom, plus a
  "← back to Project Engine" affordance. Glyphs with labels beneath.
  - `Home` = channels + DMs combined view (default). `DMs` = people. `Activity`
    = reuse the existing notification bell feed. `Later` = placeholder pointing
    at the future saved-items feature (see Future).
- **Channel sidebar (B, ~260px, resizable):** workspace header with `▾`
  dropdown (mirrors screenshot #2: invite, preferences, sign out), a search
  affordance, then scrollable collapsible sections.
- **Message pane (C, flex-1):** channel header → message list → composer.
  White (`bg-white`) / dark (`dark:bg-dark-card`).
- **Thread/profile flexpane (D, ~380px):** **pushes** pane C narrower (does not
  overlay) on desktop; overlays on narrow screens. One open at a time.

The data hooks are unchanged; the ChatWidget keeps its multi-pane behavior but
imports the rebuilt shared primitives so it inherits the new look.

## Visual System (brand-mapped)

The signature Slack split — **dark sidebar + light message pane** — but with
PE's neutral-dark surfaces and indigo accents instead of aubergine.

New `tailwind.config.js` token group (`slack`), mapped to existing palette:

```js
slack: {
  // sidebar (dark in BOTH themes, like Slack)
  sidebar:      '#1a1d24',   // ~ existing dark.surface family
  'sidebar-2':  '#15171d',   // rail, slightly darker
  'item-hover': 'rgba(255,255,255,0.06)',
  'item-active':'#4f46e5',   // brand-600
  text:         'rgba(255,255,255,0.72)',
  'text-muted': 'rgba(255,255,255,0.50)',
  'text-strong':'#ffffff',
  presence:     '#22c55e',   // priority.green
  mention:      '#ef4444',   // priority.red badge
  // message pane
  pane:         '#ffffff',
  'pane-text':  '#1d1c1d',
  border:       'rgba(0,0,0,0.10)',
}
```
Dark-mode message pane uses existing `dark.card` / `dark.border`. Exact
dark-mode hexes verified against the live build during phase 1.

Type scale (Lato, 400/700):

| Element | size / line-height | weight |
|---|---|---|
| **Message body** | **15px / 22px** | 400 |
| Channel header name | 18px / 24px | 700 |
| Sender name | 15px | 700 |
| Timestamp | 12px | 400 (muted) |
| Sidebar item | 15px | 400 read / **700 unread** |
| Sidebar section header | 13px | 700, title-case |

Key visual rules:
- Avatars **36×36 rounded-square** (`rounded-lg`), not circles.
- Unread sidebar items: **bold + bright white**; read: muted 400. Mention =
  red pill badge. No badge unless mentioned.
- Presence: filled green dot active / hollow ring away.
- **@mention-you highlight:** `border-l-2 border-amber-400 bg-amber-400/10`;
  mention token = brand-tinted chip.
- Reaction pill: rounded-full, emoji+count; **your reaction = brand-indigo
  fill/border**; trailing `+` add button.
- Hover row bg: `bg-slate-50 dark:bg-white/5`.
- Send button: brand-indigo enabled / gray disabled.

## Message Pane Behavior

**Grouping (the #1 "feels like Slack" detail):** consecutive messages from the
same author within ~5 min collapse — avatar + name + timestamp render once
("lead" row); follow-ups are tight rows with an empty avatar gutter and a
hover-only left timestamp. New author / >5-min gap / date boundary breaks it.

```js
const isLead = msg.author_id !== prev?.author_id
  || (ts(msg) - ts(prev)) > 5*60*1000
  || isNewDay(msg, prev);
```

- **Hover toolbar:** floats top-right, slightly above the row edge, absolutely
  positioned (never shifts layout): quick-react · add reaction · reply in
  thread · overflow `⋯` (copy link, mark unread, edit/delete-if-mine).
- **Reactions:** existing `useMessageReactions`; pill row, your reaction
  highlighted, `+` opens picker.
- **Threads:** reply opens the right flexpane (existing `useThread` /
  `useThreadCounts`). Root shows footer: participant avatars + "N replies" +
  "last reply …" → opens panel.
- **Sticky date dividers:** "Today" / "Yesterday" / "June 12" pill, sticky at
  top while scrolling.
- **"New messages" line:** colored rule + label at first unread, from
  `last_read_at`.
- **Jump-to-bottom:** floating pill bottom-right when scrolled up; rides unread
  count.

## Composer

One bordered rounded box (toolbar + textarea + action row inside the border),
`focus-within` darkens border.
- **Formatting toolbar:** Bold · Italic · Strikethrough · | · Link · | ·
  Ordered list · Bulleted list · Blockquote · | · Code · Code block. Toggled by
  an "Aa" button. Wires to existing markdown (`**bold**`, `_italic_`,
  `[link](url)`) + adds the missing tokens.
- **Action row:** `+` attach · Aa · emoji · `@` mention · (existing
  image/attachment flow) · **Send** (brand-indigo / gray disabled).
- `Enter` sends, `Shift+Enter` newline. Reply/edit context docks above input.
- Existing draft persistence + mention popover + upload guards reused as-is.

## Keyboard Shortcuts (scoped to chat surface)

- **Cmd/Ctrl+K** — quick switcher (the headline feature).
- **↑ / ↓** — move between conversations in the sidebar.
- **Esc** — close thread/flexpane; in switcher, dismiss.
- **Cmd/Ctrl+B / I** — bold / italic in composer.
- (Documented set rendered in a `Cmd+/` cheat-sheet later if desired.)

## Component Tree (new / rebuilt)

```
ChatPage (full-viewport takeover; hides app Layout)
├── WorkspaceRail            NEW
├── ChannelSidebar           NEW
│   ├── WorkspaceHeader (▾ menu)
│   ├── SidebarSearch
│   └── SidebarSection / SidebarRow   (#prefix, presence, unread-bold, badge)
├── MessagePane
│   ├── ChannelHeader        NEW  (name+icon, tabs, member stack, search, details)
│   ├── MessageList          REBUILT  (grouping, dividers, new-line, jump-to-bottom)
│   │   └── MessageRow        REBUILT  (lead vs follow-up, hover toolbar, reactions, thread footer)
│   └── Composer             REBUILT  (format toolbar, action row)   ← shared w/ widget
├── ThreadPanel              RESTYLED (flexpane that pushes pane)
└── QuickSwitcher            NEW  (Cmd+K fuzzy modal)
```

Shared primitives (`MessageRow`, `Composer`, `MessageList`, `Avatar`,
`ReactionPills`, `PresenceDot`) live in `src/components/chat/` and the
**ChatWidget imports the same ones** — that is how the widget reskins.

## Phasing (each phase independently shippable)

1. **Tokens & shell** — Lato, `slack` Tailwind tokens, three-column takeover
   layout, WorkspaceRail, ChannelSidebar with collapsible sections + taxonomy.
2. **Message pane** — grouping, 36px square avatars, hover toolbar, sticky date
   dividers, new-messages line, jump-to-bottom, @mention highlight.
3. **Composer & threads** — formatting toolbar, action row, restyled thread
   flexpane, typing indicator.
4. **Quick switcher (Cmd+K) + keyboard shortcuts.**
5. **Widget reskin** — point ChatWidget at shared primitives; visual parity.

## Future (needs DB — explicitly out of scope, recommended next)

- **Pinned messages** — `pinned`/pin table; header "📌 N pinned" flyout.
- **Saved / "Later"** — bookmark table; powers the rail's Later tab.
- **Custom status** — emoji + text on `profiles` (screenshot #3's status menu).
- **Channel topic/description** — column on `conversations`.
- **Edit message** — `edited_at` column (currently only soft-delete exists).
- **Mark-unread (persisted)** — the simple "rewind `last_read_at`" version needs
  no schema change and is folded into phase 2; a richer per-message unread state
  would need DB.

## Non-Goals

- No data-model / RLS / migration changes for in-scope work.
- No change to task/escalation/email pipelines.
- Cards, hubs internals, and task management UI untouched (only their chat
  surfaces gain the new look via shared primitives).
