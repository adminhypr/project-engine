# Task Chat — Design Document

**Date:** 2026-04-24
**Status:** Approved, ready for implementation planning
**Scope:** Feature #1 from David's 2026-04-23 request list (live chat on tasks)
**Parent design:** `docs/plans/2026-04-23-task-improvements-design.md`

This ships as migration **046** (045 was consumed by the manual-Done sync trigger that closed a UX gap in 044).

---

## Summary of UX decisions

| Decision | Choice |
|---|---|
| Panel layout | Chat section inline (primary), Comments collapsed accordion below |
| Input features | Full DM parity: text, @mentions, emoji reactions, quote-reply, threads, attachments, typing indicators |
| Notifications | Moderate — @mentions drive bell + email; other messages surface only via widget + in-panel |
| Access | Any user who can view the task can read and post |
| Unread tracking | First-visit auto-enrolment (viewer opens Chat → added to `conversation_participants`) |
| Chat widget surfacing | Task chats appear in a new "Tasks" section (sibling to DMs and Groups) while `tasks.status != 'Done'` and the user is a participant. Disappear on Done, reappear on reopen. |
| Click behavior | Compact chat pane in widget; "Open task →" link escalates to full detail panel |
| @mention autocomplete | Org-wide suggestions; mentioning a non-participant auto-enrols them (Agent/Client excluded unless already participants) |
| Thread UI | Split column inside the Chat section (below ~700px panel width, falls back to stacked overlay) |
| Done-task access | Chat stays accessible via the task detail panel; just hidden from the widget |
| Chat creation | Eager — AFTER INSERT trigger on `tasks` creates the conversation + seeds participants |

---

## Migration 046 — schema + triggers + backfill

### `conversations` extensions
- `alter table public.conversations add column task_id uuid references public.tasks(id) on delete cascade;`
- `create unique index conversations_task_uniq on public.conversations(task_id) where kind='task' and task_id is not null;`
- Extend the existing `kind` CHECK to include `'task'` (drop + recreate).

### Trigger `trg_create_task_chat_on_task_insert`
AFTER INSERT on `tasks`. Creates one `conversations` row (`kind='task'`, `task_id=NEW.id`, `created_by=NEW.assigned_by`, `name=NULL`). Then seeds `conversation_participants` with the assigner and (separately) relies on the next trigger to handle assignees as they're inserted.

### Trigger `trg_sync_task_chat_on_assignee_change`
AFTER INSERT on `task_assignees`. Upserts `(conversation_id, profile_id)` into `conversation_participants` for the task's conversation, setting `last_read_at=now()` so new enrolees don't land with phantom unread counts.

### RPC `ensure_task_chat_participant(tid uuid)`
SECURITY DEFINER. Checks the caller can SELECT the parent task (delegates to task RLS), then upserts `(conversation_id, profile_id=auth.uid(), last_read_at=now())` into `conversation_participants`. Called from the client the first time a viewer opens the Chat section of a task they aren't already enrolled in.

### RLS extensions
- `conversations` SELECT: existing `is_conversation_participant(cid)` still works. For `kind='task'` add a branch allowing SELECT if the caller can read the parent task.
- `dm_messages` SELECT + INSERT: for `kind='task'` conversations, allow if the caller can read the parent task (open-to-viewers per access decision).
- `conversation_participants` INSERT: allow if the caller can read the parent task (enables first-visit auto-enrolment without a separate RPC).

### Backfill
- INSERT a conversation for every existing task (idempotent — `on conflict do nothing`).
- INSERT participants for every existing `task_assignees` row + every `tasks.assigned_by` that isn't already a participant.

### Mention auto-enrolment
- Extend the existing `dm_messages` INSERT trigger (or add a new one specifically for `kind='task'`) that parses `@profile_id` mentions in the message body and upserts missing mentioned users into `conversation_participants`. Skip if the mentioned user is Agent/Client and not already a participant.

---

## Lifecycle

### New task created
Trigger creates conversation + seeds assigner. Per-assignee trigger adds each primary assignee as `task_assignees` rows are inserted. Widget for those participants immediately shows the new task.

### Add assignee mid-task
Per-assignee trigger upserts the new participant. `last_read_at=now()` means they start with zero unread on historical messages.

### First visit by viewer (manager/admin/etc.)
Client calls `ensure_task_chat_participant(tid)` on Chat section mount for any task the viewer can see but isn't yet participating in. After RPC returns, realtime subscription picks up the new participant row and the task appears in their widget.

### @mention pulls someone in
Message INSERT trigger parses mentions; any mentioned profile not yet a participant is inserted. Realtime event surfaces it in their widget + bell.

### Task status → Done
No DB mutation on the conversation. The widget's Tasks-section query filters by `t.status != 'Done'`, so the task drops out of everyone's widget. Messages and history intact; accessible via the task detail panel.

### Task reopened (unmark from 044)
Status flips back to In Progress. Next widget fetch includes the task again.

### Task deleted
`on delete cascade` on `conversations.task_id` removes the conversation + messages. Participants rows cascade too.

---

## Frontend

### New hooks
- `src/hooks/useTaskChat.js` — mirrors `useConversation` but scoped to `kind='task'`. Handles the `ensure_task_chat_participant` call on first mount for non-participants. Exposes messages, sendMessage (with @mention parsing), markRead, and thread state.

### Extended hooks
- `useConversations` — adds a new `tasks` section alongside `recent` (DMs) and `groups`. Query filter: `kind='task'` + `tasks.status != 'Done'` + participant in `conversation_participants`. Sort by `max(last_message_at, task.last_updated) desc`.
- Task row unread: extend `useTasks` enrichment with per-task `unread_chat_count` joined from `dm_messages` vs. `conversation_participants.last_read_at`. Used to render the `💬` icon on task rows.

### UI changes
- **ChatWidget**: new "Tasks" section; compact chat pane opens on click with header (title + urgency dot + N/M chip + "Open task →" link).
- **TaskDetailPanel**: Chat section inserted between Notes and Comments. Comments section wrapped in an accordion component, collapsed by default. Auto-scroll to Chat section header on open when unread > 0.
- **TaskTable**: small `💬` icon next to the progress chip when `unread_chat_count > 0`. Click opens panel scrolled to Chat.
- **Thread column**: split inside the Chat section using the existing `chatupgrade` pattern; collapses to overlay below ~700px panel width.

---

## Notifications

- **NotificationBell**: new mention source `task_chat`. Extends `useMentionNotifications` with task chat mentions. Click opens task panel scrolled to the mentioning message.
- **Email**: reuse `dm-offline-notify`. Task chats are conversations; mentions-only rule from migration 035 already covers them. Zero new edge function code.
- **In-panel signals**: unread divider line in the message list; "N new messages" label at the boundary.

---

## Testing

- Pure helpers in `src/lib/taskChat.js` + tests in `src/lib/__tests__/taskChat.test.js` for:
  - Participant filter (who sees the widget entry)
  - Widget sort order helper
  - Unread count derivation
- Migration smoke (apply to a staging scratch project or use the Management API against a temporary task):
  - Insert task → conversation exists + participants seeded
  - Add assignee → participant row created with current `last_read_at`
  - Flip status to Done → widget query excludes the conversation
  - Flip back to In Progress → widget query re-includes
- Manual UI smoke: 10-step checklist adapted from 044 style.

---

## Rollout

Stacked commits on one branch (`chatimprovements` is merged; create `task-chat` or reuse `main` with per-feature commits — team preference).

1. Migration 046 SQL file (written; not applied yet).
2. Apply migration via Management API (same pattern as 044/045).
3. Hooks: `useTaskChat`, extend `useConversations` Tasks section.
4. ChatWidget: Tasks section UI + compact pane header with escalate link.
5. TaskDetailPanel: Chat section inline + Comments accordion + auto-scroll behavior.
6. Thread split column (borrow `chatupgrade` pattern).
7. Task row unread `💬` icon + `useTasks` enrichment for `unread_chat_count`.
8. @mention auto-enrolment trigger + NotificationBell `task_chat` source.
9. CLAUDE.md migration entry; mark feature 1 shipped in parent design doc.

## Deferred

- Full-page "All Task Chats" inbox view — can ship in v2 if David asks for bulk triage.
- Emoji reactions count rollup on the widget row — nice polish but not essential.
- Search across task chat messages — relies on existing DM search infra once that lands.

---

## Risk & mitigations

| Risk | Mitigation |
|---|---|
| Widget clutter for managers with many tasks | Participant rule limits widget to tasks the user has touched (assignees + assigner at creation, plus first-visit self-enrolment). Managers who just RLS-view without opening Chat don't get widget entries. |
| Backfill insert count for large orgs | Trivial at current scale (hundreds of tasks). Dry-run `select count(*)` before running; chunk if >10k rows. |
| Open-to-viewers creates candor concerns | Documented explicitly so users know their task chat is org-visible by default. David approved. If needed later, we can add a per-task "Private chat" toggle in v2. |
| Thread split column in a narrow panel | Fallback to stacked overlay below 700px. Borrow the column math from the `chatupgrade` branch. |
| Tasks section subscription volume | Mirrors DM groups, which already work at scale. Monitor if problems emerge. |
