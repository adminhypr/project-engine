# Company Chat Widget — Design

**Status:** Draft — awaiting user review
**Author:** adminhypr (drafted with Claude Code)
**Date:** 2026-04-17
**Target branch:** `feature/chat-widget` (to be branched off `main`)

## 1. Problem

Project Engine currently supports group chat only inside Project Hubs (Campfire). Staff who are not co-members of the same hub have no in-app way to message each other. Task assignment is also a separate page-level flow — users cannot hand off work inside a conversation.

We need a Messenger-style persistent chat widget that lets any two employees converse, with a first-class "assign a task to this person" action that lives inside the conversation.

## 2. Goals

- Persistent, floating bottom-right chat widget, hidden/shown/expanded by the user.
- Contact list organized as **Recent → Teammates → Company**, with search.
- 1:1 direct messages between any two employees, persisted and realtime.
- Online/offline presence indicators across the app.
- "Assign task" action inline in any 1:1 conversation — opens a mini form that calls the existing `assignTask` flow; falls back to the full Assign page for complex cases.
- In-app unread badges. Offline-delay email notifications for missed DMs.
- Schema designed for future group DMs; v1 UI exposes 1:1 only.

## 3. Non-goals (v1)

- Group DM UI (schema supports it; UI deferred).
- Typing indicators.
- Per-message read receipts / blue-tick.
- Browser push notifications.
- Voice / video / calling.
- Editing a sent message (delete-only).
- Message reactions / threads.
- Search inside message history.
- `@mentions` inside 1:1 DMs (nonsensical with 2 participants — re-enabled when groups ship).

## 4. UX

### 4.1 Widget states

| State | What's visible |
|---|---|
| `collapsed` | Circular launcher pill bottom-right with total-unread badge. Click → `expanded`. |
| `expanded` (no thread open) | Vertical panel (≈360×520 px) showing search bar + contact list. |
| `expanded + 1–3 conversation panes` | Conversation panes stack to the left of the main panel, Messenger-style. Each pane has its own minimize / close. |
| Overflow (>3 open threads) | Additional threads collapse to avatar tabs left of the visible stack; click restores. |

Widget state (expanded flag, list of open conversation ids, list of minimized ids) persists in `localStorage` under `pe-chat-state-{profileId}`. Cleared on logout.

### 4.2 Contact list sections

1. **Recent** — up to 8 conversations the user has exchanged messages in, sorted by `conversations.last_message_at` desc. Each row shows the other participant's name + avatar + presence dot + unread badge + last-message preview.
2. **Teammates** — all profiles that share at least one `team_id` with the current user, minus self, minus anyone already shown in Recent. Presence dot. Click creates-or-opens the 1:1 conversation.
3. **Company** — all remaining profiles. Same behavior.

A single search input above the list fuzzy-filters by name across all three sections, preserving section grouping when matches exist in each.

### 4.3 Conversation pane

- Header: avatar + name + presence state ("Online" / "Last seen 12m ago"), **Assign task** button, minimize, close.
- Body: message list, newest at bottom, paginated (50 per page, "Load earlier" button) — identical pattern to `useHubChat`.
- Composer: `RichInput` (with mentions source = participants; effectively inert in 1:1) + image upload button.
- Delete own message → soft delete. Row's `deleted_at` is set; all participants (including the author) see a "message deleted" placeholder. Original content is retained in the database for audit but never rendered after deletion.
- Opening the pane marks the conversation read (`last_read_at = now()` via `markRead` RPC).

### 4.4 Assign task from chat

Clicking **Assign task** in a 1:1 header opens `AssignFromChatModal` inline over the conversation pane:

Fields: Title (required), Urgency (required, default Med), Due date, Notes. Assignee and team are implicit from the conversation's other participant (if that participant belongs to multiple teams, a team picker appears — same logic as `AssignTaskPage`).

"Open full form" link → navigates to `/assign?assignee={id}&team={id}&title={…}&urgency={…}&due={…}&notes={…}`. `AssignTaskPage` is extended to read these query params on mount and pre-fill the form.

On submit: `useTaskActions.assignTask({ assigneeIds: [otherUserId], title, urgency, dueDate, notes, allProfiles, teamId })`. On success:
- Inserts a system-kind `dm_messages` row: `"You assigned a task: **{title}** (due {date})"`, which both participants see linking to the task.
- Dismisses modal, fires success toast.
- The recipient gets the existing assigned-task email automatically via the `notify` edge function (no new plumbing).

## 5. Data model

Migration: `supabase/migrations/027_direct_messages.sql`

### 5.1 Tables

```sql
create table conversations (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'dm' check (kind in ('dm','group')),
  title           text,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_message_preview text
);

create table conversation_participants (
  conversation_id uuid references conversations(id) on delete cascade,
  user_id         uuid references profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default 'epoch',
  muted           boolean not null default false,
  primary key (conversation_id, user_id)
);

create table dm_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  author_id       uuid not null references profiles(id) on delete cascade,
  kind            text not null default 'user' check (kind in ('user','system')),
  content         text,
  mentions        jsonb not null default '[]',
  inline_images   jsonb not null default '[]',
  deleted_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index on conversation_participants (user_id);
create index on dm_messages (conversation_id, created_at desc);
```

### 5.2 1:1 uniqueness

Enforced via an RPC, not a constraint (a constraint on a sorted pair is awkward across three rows — the `conversations` row and two `conversation_participants` rows):

```sql
create or replace function get_or_create_dm(other_user_id uuid)
returns uuid
language plpgsql security definer
as $$
declare
  me uuid := auth.uid();
  existing uuid;
  new_id uuid;
begin
  if me = other_user_id then raise exception 'cannot DM self'; end if;

  -- Find an existing 1:1 between me and other_user_id
  select c.id into existing
  from conversations c
  where c.kind = 'dm'
    and exists (select 1 from conversation_participants where conversation_id = c.id and user_id = me)
    and exists (select 1 from conversation_participants where conversation_id = c.id and user_id = other_user_id)
    and (select count(*) from conversation_participants where conversation_id = c.id) = 2
  limit 1;

  if existing is not null then return existing; end if;

  insert into conversations (kind, created_by) values ('dm', me) returning id into new_id;
  insert into conversation_participants (conversation_id, user_id) values (new_id, me), (new_id, other_user_id);
  return new_id;
end $$;
```

### 5.3 RLS

```sql
alter table conversations enable row level security;
alter table conversation_participants enable row level security;
alter table dm_messages enable row level security;

-- Helper: am I a participant?
create or replace function is_conversation_participant(cid uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from conversation_participants
    where conversation_id = cid and user_id = auth.uid()
  )
$$;

-- conversations
create policy "participants read conversation" on conversations
  for select using (is_conversation_participant(id));
create policy "participants update conversation" on conversations
  for update using (is_conversation_participant(id));
-- No INSERT or DELETE policy → default-deny. Conversations are created exclusively
-- via the get_or_create_dm RPC (security definer) which bypasses RLS.

-- conversation_participants
create policy "read own participations" on conversation_participants
  for select using (user_id = auth.uid() or is_conversation_participant(conversation_id));
create policy "update own participation" on conversation_participants
  for update using (user_id = auth.uid());
-- No INSERT or DELETE policy → default-deny. Participant rows are created exclusively
-- via the get_or_create_dm RPC (security definer).

-- dm_messages
create policy "participants read messages" on dm_messages
  for select using (is_conversation_participant(conversation_id));
create policy "participants insert messages" on dm_messages
  for insert with check (is_conversation_participant(conversation_id) and author_id = auth.uid());
create policy "author soft-delete own messages" on dm_messages
  for update using (author_id = auth.uid());
```

### 5.4 Triggers

```sql
create or replace function bump_conversation_last_message()
returns trigger language plpgsql as $$
begin
  update conversations
    set last_message_at = new.created_at,
        last_message_preview = left(coalesce(new.content, ''), 140)
    where id = new.conversation_id;
  return new;
end $$;

create trigger dm_messages_bump_last
  after insert on dm_messages
  for each row execute function bump_conversation_last_message();
```

### 5.5 Realtime

```sql
alter publication supabase_realtime add table dm_messages;
alter publication supabase_realtime add table conversations;
```

## 6. Client architecture

### 6.1 Hooks (`src/hooks/`)

- **`useConversations()`** — lists current user's conversations with joined "other participant" profile(s), unread count, last-message preview, sorted by `last_message_at` desc. Subscribes to a module-level `EventTarget` to react to incoming messages from the global subscription.
- **`useConversation(conversationId)`** — single thread's message stream with pagination + `sendMessage(content, inlineImages)`, `deleteMessage(id)`, `markRead()`. Lifts `useHubChat` almost verbatim.
- **`useDmRealtime()`** — **single global subscription** to `dm_messages` INSERTs. RLS ensures only rows from conversations the user participates in are delivered. Fires events on a module-level `EventTarget` that both `useConversations` and any open `useConversation` listen to.
- **`useGlobalPresence()`** — mounted once in `AuthProvider`. One app-wide Supabase presence channel keyed by `user_id`. Returns `Map<userId, { online: boolean, lastSeenAt: Date }>`.
- **`useContactList()`** — composes `useProfiles` + `useConversations` + `useGlobalPresence` into `{ recent, teammates, company }` sections with dedup.

### 6.2 Components (`src/components/chat/`)

```
ChatWidget.jsx              — orchestrator; reads/writes localStorage; renders launcher or panels
  ChatLauncher.jsx          — collapsed pill + total-unread badge
  ChatPanel.jsx             — expanded contact-list panel
    ContactSearch.jsx
    ContactList.jsx         — 3 sections
      ContactRow.jsx
  ConversationStack.jsx     — stacks up to 3 ConversationPane, overflow → avatar tabs
    ConversationPane.jsx
      ConversationHeader.jsx  — presence, Assign task button, controls
      MessageList.jsx          — reuses RichContentRenderer
      ChatComposer.jsx         — wraps RichInput
      AssignFromChatModal.jsx  — inline quick-create form
```

`ChatWidget` is rendered once in `src/App.jsx` inside `AuthProvider`, as a sibling to `<Routes>`, so it persists across navigation.

### 6.3 Routing / query-string prefill

`AssignTaskPage` (`src/pages/AssignTaskPage.jsx`) is extended to read these optional query params on mount: `assignee`, `team`, `title`, `urgency`, `due`, `notes`. When present, the form's initial state is populated from them. Existing behavior is preserved when they're absent.

### 6.4 Realtime strategy

One global subscription (`useDmRealtime`), one global presence channel (`useGlobalPresence`). No per-conversation subscriptions. Matches the `useMentionNotifications` pattern.

## 7. Notifications

### 7.1 In-app

- Per-conversation unread badge on each `ContactRow`.
- Total-unread aggregate badge on `ChatLauncher`.
- `NotificationBell` gains a fifth category, "New DM". Aggregates to one entry per sender per session: "You have new messages from {name}". Clicking routes to the chat widget and opens that thread.

### 7.2 Email (offline-delay)

New edge function `supabase/functions/dm-offline-notify/` (Deno + Resend).

**Flow:**

1. DB webhook fires on `dm_messages` INSERT → pushes `{message_id, recipient_user_id}` rows to a new `pending_dm_emails` queue table (one row per non-author participant).
2. A scheduled cron (every 60 s) runs the function, which processes queue rows whose `enqueued_at < now() - interval '3 minutes'`.
3. For each row: fetch the recipient's `last_read_at` on that conversation + most recent presence heartbeat. If the message is still unread **and** the recipient has not been seen within 60 s, send an email via Resend with a digest of all unsent messages in that conversation for that recipient in the window. Otherwise drop the queue row.
4. Debounce: at most one email per `(recipient, conversation)` per 15 minutes — tracked via a `dm_email_log` table.

This mirrors the existing `send-alerts` cron pattern for task alerts.

## 8. Security

- Every data-access path enforced by RLS (Section 5.3).
- `get_or_create_dm` RPC is `security definer` but explicitly whitelists `auth.uid()` as one of the two participants — cannot create a conversation between two other users.
- Soft-delete only; messages never hard-deleted, preserving audit trail.
- Inline image uploads use a **new `dm-attachments` Storage bucket** with identical 5 MB limit and RLS requiring the uploader/reader to be a participant in the relevant conversation. Separate from `task-attachments` to keep lifecycles independent — a task's attachments should not leak into a chat's retention policy, and vice versa.

## 9. Testing

Unit tests in `src/lib/__tests__/`:

- `dmContacts.test.js` — contact-list bucketing into Recent/Teammates/Company, dedup, search filtering.
- `dmUnread.test.js` — unread count derivation from `last_read_at` vs message timestamps.
- `assignFromChatPrefill.test.js` — query-string encode/decode round trips for the "Open full form" deep link.
- `conversationOrdering.test.js` — sort by `last_message_at`, pinned-open behavior.

Component-level smoke tests (Testing Library) for `ChatWidget` open/close and `AssignFromChatModal` submit are deferred to a follow-up — pattern-matches the existing codebase which favors logic-layer testing.

## 10. Rollout

Ten sub-steps, each independently deployable:

1. **Migration 027** + RLS + triggers + `get_or_create_dm` RPC.
2. Enable realtime publication on the two new tables.
3. Hooks: `useGlobalPresence`, `useDmRealtime`, `useConversations`, `useConversation`, `useContactList`.
4. `ChatWidget` shell (launcher + panel states) with localStorage persistence.
5. `ContactList` + search, opening a thread creates-or-reuses via `get_or_create_dm`.
6. `ConversationPane` with send / delete / pagination (no Assign flow yet).
7. `ConversationStack` for 1–3 concurrent panes + overflow tabs.
8. `AssignFromChatModal` + `AssignTaskPage` query-string prefill.
9. `dm-offline-notify` edge function + `pending_dm_emails` queue + cron.
10. `NotificationBell` "New DM" category integration.

Steps 1–6 together ship a minimal working DM system. 7–10 add polish and alerts.

## 11. Open questions

1. **Deleted-user handling in existing conversations.** `conversation_participants` cascades on `profiles` delete, which removes that user from the pair — but the `conversations` row and the other participant's messages remain. The remaining user will see the counterpart as "Unknown user". This matches existing behavior in `tasks` (deleted assigner/assignee shows as blank) and needs no special handling for v1, but flag if a product decision emerges.
2. **Cross-tab coordination.** Widget state is per-tab localStorage. If a user opens two tabs, each widget maintains its own open-thread list. Messages sync via realtime so state stays consistent; only the UI "which threads are popped open" diverges. Accepted for v1.

Otherwise: revisit before starting steps 7–10 if UX of steps 1–6 reveals surprises.

## 12. Files touched (preview)

**New:**
- `supabase/migrations/027_direct_messages.sql`
- `supabase/functions/dm-offline-notify/index.ts`
- `src/hooks/useConversations.js`
- `src/hooks/useConversation.js`
- `src/hooks/useDmRealtime.js`
- `src/hooks/useGlobalPresence.js`
- `src/hooks/useContactList.js`
- `src/components/chat/*.jsx` (≈10 files)
- `src/lib/dmContacts.js`
- `src/lib/__tests__/dmContacts.test.js`
- `src/lib/__tests__/dmUnread.test.js`
- `src/lib/__tests__/assignFromChatPrefill.test.js`
- `src/lib/__tests__/conversationOrdering.test.js`

**Modified:**
- `src/App.jsx` — mount `ChatWidget` inside `AuthProvider`.
- `src/pages/AssignTaskPage.jsx` — read `assignee/team/title/urgency/due/notes` query params on mount.
- `src/components/notifications/NotificationBell.jsx` — add "New DM" category.
- `src/contexts/AuthContext.jsx` (or wherever provider lives) — mount `useGlobalPresence`.
- `CLAUDE.md` — document new hooks, migration, and chat widget architecture.
