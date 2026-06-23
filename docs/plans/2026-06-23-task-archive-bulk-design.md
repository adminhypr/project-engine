# Task Archive + Bulk Actions — Design

**Date:** 2026-06-23
**Status:** Implemented (branch `task-archive-bulk`). Pending: apply migration 105 to Supabase; real-UI smoke test.

## Problem

Two related asks:

1. **Bulk actions on task lists.** — Already 95% shipped. All three task lists (My Tasks, Team View, Admin Overview) have row checkboxes, a select-all bar, and bulk **Change status / Change urgency / Delete** via `MassActionBar` + `updateTasks`/`deleteTasks`. The only missing bulk action is a non-destructive one.
2. **Archive + archive view.** — Net-new. Today the only way to remove a task from a list is a hard **Delete**. Users want to *archive* (reversibly clear a task off their list) and a place to browse/restore archived tasks.

## Decisions (locked during brainstorming)

| Question | Decision |
|----------|----------|
| Archive model | **Single archive bin** (no user-named folders) |
| Archive scope | **Personal / per-viewer** — archiving hides a task only from the archiver's lists; collaborators still see it active |
| Archive view location | **A 4th tab on My Tasks**: `[ Mine ] [ Assigned ] [ Recurring ] [ Archived ]` |
| Mechanism | A `task_archives(user_id, task_id)` junction table — NOT a column on `tasks` |

**Why personal/per-viewer:** Tasks are collaborative (assigner + multiple assignees + managers all see a row). A shared `archived_at` column would let one person hide a task out from under teammates. A per-user junction keeps each person's view independent and is strictly safe.

## Data model

New migration `105_task_archives.sql`:

```sql
create table public.task_archives (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  task_id     uuid not null references public.tasks(id)    on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (user_id, task_id)
);
alter table public.task_archives enable row level security;
```

**RLS** — every policy gated on `user_id = auth.uid()`:
- `task_archives_select` — `using (user_id = auth.uid())`
- `task_archives_insert` — `with check (user_id = auth.uid())`
- `task_archives_delete` — `using (user_id = auth.uid())`

No UPDATE policy (rows are immutable; unarchive = delete). No manager/admin escalation — archive is purely personal.

**Properties:**
- Composite PK `(user_id, task_id)` → archive is idempotent (`on conflict do nothing`), unarchive is a plain delete.
- `on delete cascade` on both FKs → hard-deleting a task or user auto-cleans archive rows (no orphans).
- No change to the `tasks` table or its RLS → can't trip the migration-042 self-update guard, `sync_effective_role`, or task-visibility predicates. Clean rollback = `drop table`.

## Data layer

**Enrichment** (`useTasks.fetchTasks`): after the existing task fetch, run
`select task_id from task_archives where user_id = <me>`, build a `Set`, tag each
enriched task with `archived: archivedSet.has(task.id)`. One extra round-trip, no
joins. Expose the set / tagged tasks on `TasksContext`.

**New actions** (`useTaskActions`):
- `archiveTasks(taskIds)` → insert `{user_id: me, task_id}` rows with `on conflict do nothing`.
- `unarchiveTasks(taskIds)` → `delete().eq('user_id', me).in('task_id', taskIds)`.
- `deleteTasks(taskIds)` already exists (used for "Delete forever").

**Refetch gotcha:** `task_archives` is NOT on the `tasks` realtime channel, so the
existing subscription won't fire on archive/unarchive. The action handlers must
call the context refetch explicitly (await before toast). Optimistic local flip of
`archived` first so the row animates out instantly, then refetch to reconcile.
Single-client + personal → no cross-user realtime needed.

## Filtering

Keep `applyFilters` untouched; split at the source list:
- **Mine / Assigned tabs** (and Team View, Admin Overview): `source.filter(t => !t.archived)` — archived rows disappear from all active lists.
- **Archived tab**: full visible set `.filter(t => t.archived)` — the universal personal bin, regardless of which list the task was archived from.

**Pure-logic helper** `src/lib/archive.js` with Vitest tests (project convention =
test pure logic only): `tagArchived(tasks, idSet)`, `splitByArchived(tasks)`.

## UI

**`MassActionBar` gains a `mode` prop** (one component, two contexts; desktop look unchanged):
- `mode="active"`: existing Change status / Change urgency / Delete **+ new Archive button** (lucide `Archive`), left of Delete.
- `mode="archived"`: **Unarchive** + **Delete forever** (existing `DeleteConfirmModal`, copy → "permanently delete"). No status/urgency selects.

**Archived tab on My Tasks:** 4th tab, reuses `TaskTable` (checkboxes, priority bars,
row→detail panel all free). Source = visible tasks where `archived === true`.
Selection clears on tab switch (already the behavior). Empty state: "Nothing
archived yet." Tab shows a count when > 0.

**Single-row archive:** `TaskDetailPanel` gets an Archive / Unarchive toggle calling
the same `archiveTasks([id])` / `unarchiveTasks([id])` — the natural one-off path.

**Archive bulk action appears** on My Tasks (Mine + Assigned), Team View, Admin
Overview (anywhere the bulk bar exists). The Archived **view** stays a single bin on
My Tasks — a task archived from Team View still lands there.

## Out of scope (YAGNI)

- Named/nested archive folders.
- Archiving recurring *templates* (Recurring tab unchanged — those are spawn configs, not task rows).
- Cross-user / manager archive visibility.
- Auto-archive rules (e.g. "archive Done tasks after N days").

## Files touched

| File | Change |
|------|--------|
| `supabase/migrations/105_task_archives.sql` (new) | Table + RLS |
| `src/lib/archive.js` (new) + test | Pure split/tag helpers |
| `src/hooks/useTasks.jsx` | Enrich `archived`, expose set; add `archiveTasks`/`unarchiveTasks` |
| `src/components/tasks/MassActionBar.jsx` | `mode` prop + Archive / Unarchive buttons |
| `src/pages/MyTasksPage.jsx` | Archived tab, bulk archive/unarchive handlers, `!archived` filter on active tabs |
| `src/pages/TeamViewPage.jsx` | `!archived` filter; Archive bulk action |
| `src/pages/AdminOverviewPage.jsx` | `!archived` filter; Archive bulk action |
| `src/components/tasks/TaskDetailPanel.jsx` | Single-row Archive/Unarchive toggle |
| `src/components/notifications/NotificationBell.jsx` | Exclude archived tasks from bell (overdue/pending/due-soon/new) — added post-review |
| `src/lib/archive.js` (new) + test | `splitByArchived` pure helper |
| `supabase/migrations/105_task_archives.sql` (new) | Table + RLS |

## Verification gates

- `npm run test:run` (pure-logic tests; project has no component tests)
- `npm run build`
- Manual UI smoke (no headless OAuth available)
