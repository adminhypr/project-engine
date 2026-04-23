# Task Improvements — Design Document

**Date:** 2026-04-23
**Status:** Approved, ready for implementation planning
**Scope:** Features 1–5 from David's 2026-04-23 request list (chat-on-task, sub-tasks, dependencies, per-assignee completion, recurring tasks)

Ops Room (#6) and activity duties (#7) are intentionally deferred to a later phase — see closing note.

---

## Summary of design decisions

| # | Feature | Decision |
|---|---|---|
| 4 | Per-assignee completion | Task stays In Progress until all assignees complete OR assigner/admin/any-assignee force-closes. `tasks.status` stays the single source of truth; per-assignee state lives on `task_assignees`. |
| 2 | Sub-tasks | Full tasks with `parent_task_id`. Parent auto-closes only when all children close. Delete cascades; close and reassign do not. |
| 3 | Task dependencies | Soft / display-only. No DB enforcement, no hard block on status transitions. Toast warning only. |
| 1 | Task chat | Reuse `conversations` + `dm_messages`. `kind='task'`, `task_id` FK. Lazy-created on first open. Hybrid placement: always in task detail; in widget only when unread or active in last 24h. |
| 5 | Recurring tasks | Template table + hourly cron spawn edge function. Simple interval model: `(unit ∈ day/week/month) × (every N)`. Skip + notify creator if all assignees invalid. |

---

## Migrations

One migration per feature, applied in order. All additive — no destructive changes.

### `044_per_assignee_completion.sql`

- `task_assignees`: add `completed_at timestamptz`, `completed_by uuid → profiles(id)`.
- Trigger on `task_assignees` after update: when every row for a task has `completed_at`, set `tasks.status='Done'`, write `task_audit_log` entry `assignee_marked_done → all_done`.
- RPC `force_close_task(task_id)` — callable by assigner, admin, or any current assignee. Sets `tasks.status='Done'`, fills `completed_at = now()` + `completed_by = caller` on any open assignee rows, writes audit `force_closed`.
- Interacts with auto-accept-on-progress (migration 036): if caller marks self done while acceptance is Pending, the existing trigger upgrades acceptance to Accepted in the same statement.

### `045_subtasks.sql`

- `tasks`: add `parent_task_id uuid → tasks(id) on delete cascade`.
- Trigger on `tasks` after status update: if every child of the parent has `status='Done'`, cascade parent to Done (same aggregation path as 044's trigger).
- Force-closing a parent with open children: children stay open. Audit entry on the parent: `force_closed_with_N_open_subtasks`.
- RLS: sub-task visibility inherits parent RLS. Anyone who can read the parent can read the child.

### `046_task_dependencies.sql`

- New table `task_dependencies (blocker_id, blocked_id, created_by, created_at)`, composite PK `(blocker_id, blocked_id)`.
- CHECK constraint: `blocker_id != blocked_id`.
- No enforcement triggers. Soft only.
- No cycle detection in v1.

### `047_task_chat.sql`

- `conversations`: add `task_id uuid → tasks(id) on delete cascade`; extend `kind` check to include `'task'`; unique partial index `(task_id) where kind='task' and task_id is not null`.
- RPC `get_or_create_task_chat(tid uuid)` — lazy creation. Creates conversation + seeds `conversation_participants` with current assignees + assigner.
- Trigger on `task_assignees` insert: if a task conversation exists for that task, add the new assignee to `conversation_participants`.
- Trigger on `tasks` update of `assigned_by`: ditto for the new assigner.
- Mention enrollment: `hub_mentions`-style pattern extended — when a mention references a non-participant, they're added to `conversation_participants` in the same statement. (Reuse existing mention insertion helper with a new `source='task_chat'` discriminator.)
- Participants who are reassigned off the task stay in the conversation (message history stays visible).

### `048_recurring_tasks.sql`

- New table `task_recurrences`:
  - Template fields: `template_title`, `template_notes`, `template_icon`, `template_urgency`, `template_due_offset_hours`, `team_id`.
  - Schedule fields: `interval_unit text check ('day','week','month')`, `interval_every int not null default 1 check (interval_every >= 1)`, `anchor_at timestamptz`, `next_run_at timestamptz`.
  - Meta: `created_by`, `is_active bool default true`, `created_at`, `updated_at`.
- New table `task_recurrence_assignees (recurrence_id, profile_id)` — many-to-many.
- New table `task_recurrence_audit (recurrence_id, event_type, performed_by, note, created_at)` — template-level audit, separate from per-task `task_audit_log`.
- `tasks`: add `recurrence_id uuid → task_recurrences(id) on delete set null`.
- Realtime publication: add `task_recurrences`, `task_recurrence_assignees`.
- RLS: `task_recurrences` visible to creator, admin, managers of the target team (if set). `task_recurrence_assignees` inherits from parent.

---

## Edge functions

### `supabase/functions/spawn-recurring-tasks/` (new)

- pg_cron schedule: hourly.
- Query: `task_recurrences where is_active = true and next_run_at <= now()`.
- For each, under an advisory lock keyed on `recurrence_id`:
  1. Join `task_recurrence_assignees` with `profiles` to get valid (non-deleted, non-deactivated) assignees.
  2. If zero valid assignees: set `is_active=false`, enqueue in-app + email notification to `created_by` ("Recurring task '{title}' couldn't spawn — no active assignees"), write `task_recurrence_audit` entry `spawn_failed_no_assignees`. Continue.
  3. Otherwise: insert `tasks` row (title, notes, icon, urgency, due=`now() + template_due_offset_hours`, `assigned_by = created_by`, `team_id`, `recurrence_id`). Insert `task_assignees` rows. Set `tasks.assigned_to` to the first valid assignee for backward compatibility. Write `task_audit_log` entry `task_created` with note `"(recurring: {template_title})"`.
  4. Advance `next_run_at` to the next future occurrence (`anchor_at + k × interval` for smallest k making it `> now()`). Never backfill missed runs.
- Idempotent: uses `next_run_at <= now()` check + advisory lock to survive overlapping cron fires.

### `supabase/functions/notify/` (extended)

Add two cases:
- `task_force_closed` — email all assignees + assigner.
- `recurring_spawn_failed` — email template creator (fired by migration 048 trigger on `task_recurrence_audit` or by the spawn function directly).

Per-assignee mark-done is NOT emailed (noise). It surfaces in-app via realtime + in task chat.

Task chat offline email is auto-covered by `dm-offline-notify` since task chats are `conversations`.

---

## Frontend

### Hooks

New:
- `src/hooks/useTaskAssigneeCompletion.js` — `markSelfComplete(taskId)`, `unmarkSelf(taskId)`, `forceClose(taskId)`, `toggleOther(taskId, profileId)` (admin/assigner).
- `src/hooks/useSubtasks.js` — `createSubtask(parentId, draft)`, `listChildren(parentId)`, realtime via existing `tasks` subscription.
- `src/hooks/useTaskDependencies.js` — `addDependency(blockerId, blockedId)`, `removeDependency(...)`, `listForTask(taskId)`.
- `src/hooks/useTaskChat.js` — mirrors `useConversation` for `kind='task'` conversations; calls `get_or_create_task_chat` on first open.
- `src/hooks/useRecurrences.js` — CRUD on templates + list with next-run countdown.
- `src/hooks/useMyRecurrences.js` — view-only: recurrences the current user is an assignee on.

Extended:
- `useConversations` — new "Tasks" section; filters task conversations to unread OR last-activity-within-24h.
- `useTasks` — enrich with `subtask_count`, `open_subtask_count`, `dependency_blocker_count`, `recurrence_id`, `completion_progress: {done, total}`.
- `useTaskActions` — route to new RPCs where applicable; reuse existing update path for status.

### UI changes

- **Task detail panel** gains:
  - Assignee list with per-row checkboxes + "Close out for everyone" button.
  - "Sub-tasks" section (+ Add, tree list).
  - "Blocked by" / "Blocks" chip fields.
  - "Chat" tab next to "Comments."
  - Recurrence badge + "View template" link (if spawned).
- **My Tasks / Team View** lists:
  - "2/3 done" chip on multi-assignee tasks.
  - Sub-task row with "↳ parent" hint.
  - "Hide sub-tasks" filter toggle (on by default in Team View).
- **Chat widget**:
  - New "Tasks" section below DMs + groups.
  - Filtered to task conversations that are unread OR had activity in last 24h.
- **Settings → Recurring Tasks** (new tab):
  - Create / edit form: title, notes, icon, urgency, assignees, due-offset, interval unit/every, start-at, active toggle.
  - List with next-run countdown, last-spawned link, pause / edit / delete.
  - Manager + admin + staff (staff can create own); externals (Agent/Client) cannot.

---

## Cross-cutting

### Audit

Extend `task_audit_log.event_type` check constraint:
- `assignee_marked_done`
- `assignee_unmarked`
- `force_closed`
- `subtask_added`
- `subtask_removed`
- `dependency_added`
- `dependency_removed`
- `recurring_spawned`

Template-level events (pause, edit, resume) go in the new `task_recurrence_audit` table.

### Realtime

- Existing `tasks` subscription already picks up sub-task cascades, parent auto-close, force-close — no change needed.
- Add subscriptions on: `task_assignees` (per-assignee completion fine-grained updates), `task_dependencies`, `task_recurrences`, `conversations` (already realtime; extend filter to include `kind='task'`).

### RLS

- `task_assignees` update: self for `completed_at`/`completed_by` only where `profile_id = auth.uid()`; admin + assigner can update any row.
- `task_dependencies`: insert/delete requires write access to either side (blocker or blocked) per existing task-write RLS.
- `task_recurrences`: select for creator + admin + managers of `team_id`. Insert/update for creator + admin + managers of `team_id`. Externals blocked.
- `conversations` (kind='task'): existing `is_conversation_participant` helper applies.
- Participant enrollment on chat: done via SECURITY DEFINER RPCs fired by triggers — avoids self-referencing policies (hub-RLS-recursion gotcha).

### Testing

New unit tests in `src/lib/__tests__/`:
- `perAssigneeCompletion.test.js` — aggregate Done rules, force-close semantics, auto-accept-on-mark interaction.
- `subtasks.test.js` — cascade-on-delete, parent-closes-only-when-all-done, default inheritance.
- `dependencies.test.js` — soft warn, no cycle detection.
- `recurrence.test.js` — interval math, next_run_at advancement, invalid-assignee skip path.

Each migration gets a PL/pgSQL smoke test against a Supabase test project.

---

## Rollout

One stacked PR per migration:

1. **044 — per-assignee completion.** Smallest blast radius. David's highest-value visibility win. Ships first.
2. **045 — sub-tasks.** Independent of 044. Touches My Tasks + Team View.
3. **046 — dependencies.** Independent migration; UI reuses 045's chip components.
4. **047 — task chat.** Independent; can ship in parallel with 046 if split across contributors.
5. **048 — recurring tasks.** Last. Benefits from the complete task schema; v1 template UI skips sub-task and dependency fields.

Each PR: migration + hook(s) + UI + tests + `CLAUDE.md` diff documenting the new migration.

---

## Open questions deferred to later phase

- **Ops Room (#6)** — overlaps significantly with Hubs (Campfire, presence, activity feed). Voice/video/screen-share needs a WebRTC provider decision (LiveKit / Daily / Agora). Split into: 6a presence-style "who's on what" board, 6b media layer. Separate design doc.
- **Activity duties / "roles" (#7)** — naming collision with existing `profiles.role` and `profile_teams.role`. Suggest "Duty" or "Station." Separate design doc.

Both depend on clarification from David re: Ops Room vs. Hubs scope before we invest.
