# Dedicated chat page (Slack-like) — design

**Date:** 2026-06-16
**Branch:** `slackchat`
**Status:** Design approved, implementing

## Goal

A dedicated full-page chat experience at `/chat` with a Slack-style left
conversation sidebar (search + sectioned list) next to the open conversation.
Reuses all existing chat functions (send, attachments, reactions, threads,
mentions, presence, read receipts). No database changes.

## Decisions (locked)

1. **Search** = conversations & people (filter the sidebar by name). Uses the
   existing `useContactList(query)` filtering. Message-content search is out of
   scope (possible fast-follow).
2. **Floating widget stays** — quick access anywhere; the page is for focused
   chatting. Both share the same hooks/realtime, so they stay in sync.
3. **`/chat` for everyone**; `/team-chat` retires (redirects to `/chat`). Nav
   entry becomes "Chat" for internal and external users.
4. **Single conversation sidebar** — no extra Slack icon rail (the app's own
   left nav is the workspace rail).
5. **Task chats excluded** from the page sidebar for v1 (accessed from their
   task; avoids opening a task chat without context).

## Layout

```
┌ app nav ┐┌─ ChatSidebar ──┐┌─ Conversation ─────────────┐
│ (Layout)││ search          ││ ConversationHeader          │
│         ││ Direct messages ││ MessageList (+ ThreadPanel) │
│         ││ Groups          ││ ChatComposer                │
│         ││ Campfires       ││                             │
│         ││ [+ New]         ││                             │
└─────────┘└─────────────────┘└─────────────────────────────┘
```

- Left `ChatSidebar` (~300px): `ContactSearch` + `ContactList` (existing —
  collapsible sections, unread badges, presence dots, `+ New group`). Active
  row highlighted (new additive prop).
- Right: existing `ConversationPane` in `fullPage` mode, driven by the route
  param. Threads/reactions/mentions/attachments/receipts come for free.

## Routes

- `/chat` — list, no selection (empty state or auto-restored last conversation).
- `/chat/:conversationId` — conversation open.
- `/team-chat` → redirect to `/chat`.
- Nav label "Chat" (`MessageCircle`) for internal + external.

URL-driven selection → deep-links, refresh, and back-button all work; the widget
can "pop out" to `/chat/:id`.

## Data flow

- `useContactList(query)` drives the sidebar (`conversations`, `sections`,
  `groups`, `campfires`, `presence`, `createOrOpen`, `createGroup`, `markRead`).
- Open conversation = `conversations.find(c => c.id === conversationId)` (the
  shaped object `ConversationPane` needs).
- Row click → `navigate('/chat/'+id)` + `markRead(id)`.
- New DM → `createOrOpen(userId)` → navigate to the returned id. New group →
  existing `createGroup` modal.
- Fresh id not in list yet → `refetch()` ONCE via a `triedRef` guard (mirrors
  `TeamChatPage`) — no infinite loop if RLS legitimately hides it.
- Bare `/chat` → auto-restore last conversation from `pe-chat-last-{profileId}`
  (localStorage); else empty state.
- `ChatPage` owns thread state locally (like `TeamChatPage`).

## Responsive

URL is the source of truth:
- Desktop (≥ md): both panes; empty state on the right when no `:id`.
- Mobile (< md): one pane — bare `/chat` = sidebar; `/chat/:id` = conversation
  full-width with a ← back to `/chat`.

## Empty / edge states

- No selection (desktop): "Select a conversation" + New message CTA.
- Not found (hidden/deleted/RLS): "This conversation isn't available" + back.
- No conversations yet: prompt; people sections still allow starting one.

## Safety — no destruction of existing features

- **Zero DB changes**: no migration, table, RLS, trigger, or edge-function edits.
- **Existing chat paths untouched**: page consumes `ConversationPane`,
  `useConversation`, `useContactList`, `useConversations` as-is. No send/insert/
  delete logic modified → widget, campfire, task chats, threads, reactions,
  attachments, receipts, notifications all unchanged.
- **`/team-chat` retirement** = route redirect only. Team-group conversation +
  `get_or_create_team_group` (mig 033) untouched; that group just appears in the
  Groups section.
- **Shared components** (`ContactList`/`ContactSearch`/`ConversationPane`) only
  get **additive optional props with safe defaults** → widget behavior unchanged;
  verified after.
- **Externals**: page shows only RLS-granted conversations; people-browse
  (teammates/company) sections hidden for externals.
- **localStorage**: new key `pe-chat-last-{profileId}` is distinct from the
  widget's `pe-chat-state-{profileId}`. Section-collapse state
  (`pe-chat-section-collapsed`) is intentionally shared for consistency.

## Testing (pure logic only, Vitest)

- `lib/chatLastOpened.js` — read/write/clear, round-trip + missing + corrupt JSON.
- `resolveActiveConversation(conversations, id)` — found / not-found / null.
- Page + components verified manually (repo has no component tests). Full suite +
  `npm run build` stay green.

## Rollout — one frontend PR, no migration

1. `lib/chatLastOpened.js` + tests.
2. `ChatSidebar.jsx`.
3. `ChatPage.jsx` (two-pane, responsive, thread state).
4. Routes `/chat` + `/chat/:conversationId`, redirect `/team-chat`, nav label.
5. Additive props: `ContactList` (selected id), `ContactSearch` (placeholder).

Safe to merge to main (Vercel deploys; nothing to apply on the DB).
