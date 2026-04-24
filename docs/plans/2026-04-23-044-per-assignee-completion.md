# Migration 044 — Per-Assignee Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let each assignee on a multi-assignee task mark themselves individually done. The task's overall `tasks.status` flips to `Done` only when every assignee has completed — or when assigner, admin, or any assignee force-closes it.

**Architecture:** Additive migration on `task_assignees` (two timestamp/FK cols) + one aggregate trigger + one SECURITY DEFINER RPC (`force_close_task`). `tasks.status` remains the single source of truth — no reads need to change. New per-assignee UI in `TaskDetailPanel`; new progress chip on task rows. Reuses existing realtime subscription on `task_assignees`.

**Tech Stack:** Postgres (Supabase) migrations + RLS, React hooks, Vitest, Deno edge functions.

**Parent design:** `docs/plans/2026-04-23-task-improvements-design.md`

---

## Task 1 — Write migration 044 SQL

**Files:**
- Create: `supabase/migrations/044_per_assignee_completion.sql`

**Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────
-- 044 · Per-assignee completion
-- Adds completed_at / completed_by on task_assignees so each assignee
-- can mark themselves done independently. Aggregate trigger flips
-- tasks.status='Done' only when all assignees are complete. RPC
-- force_close_task() lets assigner/admin/any-assignee close for
-- everyone (fills in completed_at on open rows, audits as "force_closed").
-- ─────────────────────────────────────────────

alter table public.task_assignees
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid references public.profiles(id) on delete set null;

create index if not exists idx_task_assignees_completed_at
  on public.task_assignees(task_id) where completed_at is not null;

-- ─────────────────────────────────────────────
-- Audit: extend event_type check to include new events.
-- 002_audit_log.sql declared the CHECK inline; Postgres auto-named it.
-- ─────────────────────────────────────────────
alter table public.task_audit_log
  drop constraint if exists task_audit_log_event_type_check;
alter table public.task_audit_log
  add constraint task_audit_log_event_type_check
  check (event_type in (
    'task_created','status_changed','urgency_changed','due_date_changed',
    'notes_updated','reassigned','accepted','declined','assigner_override',
    'assignee_marked_done','assignee_unmarked','force_closed'
  ));

-- ─────────────────────────────────────────────
-- Aggregate trigger: if every assignee on a task now has completed_at,
-- flip tasks.status to 'Done' and write one audit entry. Uses AFTER
-- UPDATE on task_assignees so the row's new state is visible to the
-- count query.
-- ─────────────────────────────────────────────
create or replace function public.aggregate_task_completion()
returns trigger as $$
declare
  total int;
  done  int;
begin
  -- Only react when completed_at actually transitioned to non-null.
  if (tg_op = 'UPDATE'
      and (old.completed_at is not distinct from new.completed_at)) then
    return new;
  end if;

  select count(*), count(*) filter (where completed_at is not null)
    into total, done
    from public.task_assignees
   where task_id = new.task_id;

  if total > 0 and total = done then
    update public.tasks
       set status = 'Done'
     where id = new.task_id and status <> 'Done';
    -- Audit only if we actually changed it
    if found then
      insert into public.task_audit_log
        (task_id, event_type, performed_by, old_value, new_value, note)
      values
        (new.task_id, 'status_changed', new.completed_by, 'In Progress', 'Done',
         'All assignees completed');
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_aggregate_task_completion on public.task_assignees;
create trigger trg_aggregate_task_completion
  after update on public.task_assignees
  for each row execute function public.aggregate_task_completion();

-- ─────────────────────────────────────────────
-- RPC: force close for everyone
--   - Caller must be assigner, admin, or a current assignee.
--   - Fills completed_at = now(), completed_by = caller for any
--     open assignee rows.
--   - Sets tasks.status='Done' if not already.
--   - Writes one 'force_closed' audit entry.
-- ─────────────────────────────────────────────
create or replace function public.force_close_task(tid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  is_admin_caller boolean;
  is_assigner boolean;
  is_assignee boolean;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select (role = 'Admin') into is_admin_caller from public.profiles where id = caller;
  select exists(select 1 from public.tasks where id = tid and assigned_by = caller) into is_assigner;
  select exists(select 1 from public.task_assignees where task_id = tid and profile_id = caller) into is_assignee;

  if not (coalesce(is_admin_caller, false) or is_assigner or is_assignee) then
    raise exception 'not authorized to close task %', tid;
  end if;

  -- Fill any open assignee rows.
  update public.task_assignees
     set completed_at = now(),
         completed_by = caller
   where task_id = tid
     and completed_at is null;

  -- Flip the task's own status if still open. The aggregate trigger
  -- will NOT fire on this path because we're updating tasks directly;
  -- so we audit here explicitly.
  update public.tasks
     set status = 'Done'
   where id = tid and status <> 'Done';

  if found then
    insert into public.task_audit_log
      (task_id, event_type, performed_by, old_value, new_value, note)
    values
      (tid, 'force_closed', caller, null, 'Done', 'Closed for everyone');
  end if;
end;
$$;

grant execute on function public.force_close_task(uuid) to authenticated;

-- ─────────────────────────────────────────────
-- RLS: self-update of completed_at / completed_by only.
-- Admin + assigner can update any row (reuses existing delete policy
-- pattern from 011). The existing UPDATE policy on task_assignees
-- didn't exist (only insert/delete were defined), so we add it here.
-- ─────────────────────────────────────────────
drop policy if exists "task_assignees_update_self" on public.task_assignees;
create policy "task_assignees_update_self"
  on public.task_assignees for update
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.tasks t
      where t.id = task_assignees.task_id and t.assigned_by = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'Admin'
    )
  )
  with check (
    profile_id = auth.uid()
    or exists (
      select 1 from public.tasks t
      where t.id = task_assignees.task_id and t.assigned_by = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'Admin'
    )
  );
```

**Step 2: Apply migration to local Supabase**

Run: `npx supabase db push` (or the project's equivalent — check `supabase/config.toml`).

Expected: migration applies cleanly; `select column_name from information_schema.columns where table_name='task_assignees'` shows `completed_at` and `completed_by`.

**Step 3: Manual smoke against a test task**

In Supabase SQL editor:

```sql
-- pick any 2-assignee task
select id from public.tasks
where id in (
  select task_id from public.task_assignees group by task_id having count(*) >= 2
)
limit 1;

-- mark one assignee done; confirm tasks.status unchanged
update public.task_assignees set completed_at = now(), completed_by = profile_id
where task_id = '<id>' and profile_id = '<profile1>';
select status from public.tasks where id = '<id>';  -- still open

-- mark last one; confirm status flips + audit row appears
update public.task_assignees set completed_at = now(), completed_by = profile_id
where task_id = '<id>' and profile_id = '<profile2>';
select status from public.tasks where id = '<id>';  -- Done
select event_type, note from public.task_audit_log where task_id = '<id>' order by created_at desc limit 3;
```

**Step 4: Commit**

```bash
git add supabase/migrations/044_per_assignee_completion.sql
git commit -m "feat(db): migration 044 — per-assignee completion

Adds completed_at / completed_by on task_assignees, an aggregate
trigger that flips tasks.status to Done when all assignees complete,
and a SECURITY DEFINER force_close_task RPC for close-for-everyone."
```

---

## Task 2 — Pure helper + tests

**Files:**
- Create: `src/lib/perAssigneeCompletion.js`
- Create: `src/lib/__tests__/perAssigneeCompletion.test.js`

**Step 1: Write the failing tests**

```js
// src/lib/__tests__/perAssigneeCompletion.test.js
import { describe, it, expect } from 'vitest'
import {
  allAssigneesComplete,
  completionProgress,
  canForceClose,
  isAssigneeOpen,
} from '../perAssigneeCompletion'

describe('perAssigneeCompletion', () => {
  const openRow      = { profile_id: 'p1', completed_at: null }
  const doneRow      = { profile_id: 'p2', completed_at: '2026-04-23T10:00:00Z', completed_by: 'p2' }
  const openRow2     = { profile_id: 'p3', completed_at: null }

  it('allAssigneesComplete: false when any open', () => {
    expect(allAssigneesComplete([openRow, doneRow])).toBe(false)
  })

  it('allAssigneesComplete: true when all done', () => {
    expect(allAssigneesComplete([doneRow, { ...doneRow, profile_id: 'p4' }])).toBe(true)
  })

  it('allAssigneesComplete: false for empty array', () => {
    expect(allAssigneesComplete([])).toBe(false)
  })

  it('completionProgress: returns {done, total}', () => {
    expect(completionProgress([openRow, doneRow, openRow2])).toEqual({ done: 1, total: 3 })
  })

  it('isAssigneeOpen: true for null completed_at', () => {
    expect(isAssigneeOpen(openRow)).toBe(true)
    expect(isAssigneeOpen(doneRow)).toBe(false)
  })

  it('canForceClose: assigner can', () => {
    const task = { assigned_by: 'u1', task_assignees: [openRow] }
    expect(canForceClose(task, 'u1', false)).toBe(true)
  })

  it('canForceClose: admin can', () => {
    const task = { assigned_by: 'u1', task_assignees: [openRow] }
    expect(canForceClose(task, 'admin', true)).toBe(true)
  })

  it('canForceClose: assignee can', () => {
    const task = { assigned_by: 'u1', task_assignees: [{ profile_id: 'u2', completed_at: null }] }
    expect(canForceClose(task, 'u2', false)).toBe(true)
  })

  it('canForceClose: random user cannot', () => {
    const task = { assigned_by: 'u1', task_assignees: [{ profile_id: 'u2', completed_at: null }] }
    expect(canForceClose(task, 'u3', false)).toBe(false)
  })
})
```

**Step 2: Run to confirm fail**

Run: `npm test -- src/lib/__tests__/perAssigneeCompletion.test.js`
Expected: FAIL — module not found.

**Step 3: Implement**

```js
// src/lib/perAssigneeCompletion.js

export function isAssigneeOpen(row) {
  return !row?.completed_at
}

export function allAssigneesComplete(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return false
  return rows.every((r) => !!r?.completed_at)
}

export function completionProgress(rows) {
  if (!Array.isArray(rows)) return { done: 0, total: 0 }
  const total = rows.length
  const done = rows.filter((r) => !!r?.completed_at).length
  return { done, total }
}

export function canForceClose(task, userId, isAdmin) {
  if (!task || !userId) return false
  if (isAdmin) return true
  if (task.assigned_by === userId) return true
  const assignees = task.task_assignees ?? []
  return assignees.some((r) => r?.profile_id === userId)
}
```

**Step 4: Run tests to confirm pass**

Run: `npm test -- src/lib/__tests__/perAssigneeCompletion.test.js`
Expected: PASS — 9 tests.

**Step 5: Commit**

```bash
git add src/lib/perAssigneeCompletion.js src/lib/__tests__/perAssigneeCompletion.test.js
git commit -m "feat(tasks): per-assignee completion helpers + tests"
```

---

## Task 3 — Extend `useTasks` to fetch completion columns

**Files:**
- Modify: `src/hooks/useTasks.js:31-39` (TASK_SELECT_FULL)

**Step 1: Update the select**

In `TASK_SELECT_FULL`, change the `task_assignees` line from:

```
task_assignees!task_assignees_task_id_fkey(profile_id, is_primary, profile:profiles!task_assignees_task_id_fkey(...))
```

to:

```
task_assignees!task_assignees_task_id_fkey(profile_id, is_primary, completed_at, completed_by, profile:profiles!task_assignees_task_id_fkey(id, full_name, avatar_url))
```

Exact replacement — copy the existing line and add `completed_at, completed_by` after `is_primary,`.

**Step 2: Verify in running app**

Run: `npm run dev`
Open a task detail panel; open browser console; confirm the task object's `task_assignees` entries now include `completed_at` and `completed_by` (probably null for existing rows).

**Step 3: Commit**

```bash
git add src/hooks/useTasks.js
git commit -m "feat(tasks): include completed_at / completed_by in task_assignees fetch"
```

---

## Task 4 — `useTaskAssigneeCompletion` hook

**Files:**
- Create: `src/hooks/useTaskAssigneeCompletion.js`

**Step 1: Write the hook**

```js
// src/hooks/useTaskAssigneeCompletion.js
import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useTaskAssigneeCompletion() {
  const { profile, isAdmin } = useAuth()

  const markSelfComplete = useCallback(async (taskId) => {
    if (!profile?.id) return { error: new Error('not authed') }
    const { error } = await supabase
      .from('task_assignees')
      .update({ completed_at: new Date().toISOString(), completed_by: profile.id })
      .eq('task_id', taskId)
      .eq('profile_id', profile.id)
    return { error }
  }, [profile?.id])

  const unmarkSelf = useCallback(async (taskId) => {
    if (!profile?.id) return { error: new Error('not authed') }
    const { error } = await supabase
      .from('task_assignees')
      .update({ completed_at: null, completed_by: null })
      .eq('task_id', taskId)
      .eq('profile_id', profile.id)
    return { error }
  }, [profile?.id])

  // Admin / assigner toggling another assignee's row.
  const setAssigneeCompletion = useCallback(async (taskId, profileId, completed) => {
    if (!profile?.id) return { error: new Error('not authed') }
    const payload = completed
      ? { completed_at: new Date().toISOString(), completed_by: profile.id }
      : { completed_at: null, completed_by: null }
    const { error } = await supabase
      .from('task_assignees')
      .update(payload)
      .eq('task_id', taskId)
      .eq('profile_id', profileId)
    return { error }
  }, [profile?.id])

  const forceClose = useCallback(async (taskId) => {
    const { error } = await supabase.rpc('force_close_task', { tid: taskId })
    return { error }
  }, [])

  return { markSelfComplete, unmarkSelf, setAssigneeCompletion, forceClose, isAdmin }
}
```

**Step 2: Commit**

```bash
git add src/hooks/useTaskAssigneeCompletion.js
git commit -m "feat(tasks): useTaskAssigneeCompletion hook"
```

---

## Task 5 — TaskDetailPanel per-assignee UI

**Files:**
- Modify: `src/components/tasks/TaskDetailPanel.jsx`

**Step 1: Read the file first to find the assignee-list render block and status-change buttons area.**

Use Read on the file; locate the section that renders `task.task_assignees` (probably as avatars or names). That's where you'll add per-row checkboxes.

**Step 2: Add imports**

At the top of `TaskDetailPanel.jsx`:

```jsx
import { useTaskAssigneeCompletion } from '../../hooks/useTaskAssigneeCompletion'
import { completionProgress, canForceClose, isAssigneeOpen } from '../../lib/perAssigneeCompletion'
import { CheckCircle2, Circle } from 'lucide-react'
```

**Step 3: Add hook usage inside the component**

Near the top of the component body:

```jsx
const {
  markSelfComplete, unmarkSelf, setAssigneeCompletion, forceClose,
} = useTaskAssigneeCompletion()
const { done, total } = completionProgress(task.task_assignees)
const canClose = canForceClose(task, profile?.id, isAdmin)
```

`profile` and `isAdmin` are already available from the existing `useAuth()` call — if not, add it.

**Step 4: Render the checkbox next to each assignee row**

In the existing assignee map, wrap each row:

```jsx
{task.task_assignees?.map((a) => {
  const open = isAssigneeOpen(a)
  const isMe = a.profile_id === profile?.id
  const canToggleOther = isAdmin || task.assigned_by === profile?.id
  const canToggle = isMe || canToggleOther
  return (
    <div key={a.profile_id} className="flex items-center gap-2">
      <button
        type="button"
        disabled={!canToggle}
        onClick={() => {
          if (isMe) open ? markSelfComplete(task.id) : unmarkSelf(task.id)
          else setAssigneeCompletion(task.id, a.profile_id, open)
        }}
        className="disabled:opacity-40"
        title={open ? 'Mark done' : 'Unmark'}
      >
        {open ? <Circle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4 text-green-600" />}
      </button>
      <span className={open ? '' : 'line-through opacity-70'}>
        {a.profile?.full_name ?? 'Unknown'}
      </span>
    </div>
  )
})}
```

**Step 5: Add "Close for everyone" button**

Below the assignee list, only when multi-assignee and there's at least one open row:

```jsx
{total > 1 && done < total && canClose && (
  <button
    type="button"
    onClick={async () => {
      if (!confirm(`Close this task for ${total - done} remaining assignee(s)?`)) return
      const { error } = await forceClose(task.id)
      if (error) alert(error.message)
    }}
    className="btn btn-secondary mt-2"
  >
    Close for everyone ({done}/{total} done)
  </button>
)}
```

**Step 6: Manual smoke test**

Run: `npm run dev`

Scenarios to verify:
1. Single-assignee task: no progress UI, no "Close for everyone" button.
2. Multi-assignee task as a non-assignee viewer: checkboxes disabled, no close button.
3. Multi-assignee task as an assignee: click own checkbox → row ticks; refresh → persists.
4. Multi-assignee task, mark all assignees done → `tasks.status` flips to Done within ~1s (realtime).
5. "Close for everyone" as assigner → all rows check, status Done, audit log has `force_closed`.

**Step 7: Commit**

```bash
git add src/components/tasks/TaskDetailPanel.jsx
git commit -m "feat(tasks): per-assignee completion UI + close-for-everyone"
```

---

## Task 6 — Progress chip on TaskTable rows

**Files:**
- Modify: `src/components/tasks/TaskTable.jsx`

**Step 1: Read the file to find the row render block.**

Locate where the task's assignees or status is rendered per row.

**Step 2: Add import**

```jsx
import { completionProgress } from '../../lib/perAssigneeCompletion'
```

**Step 3: Render chip on multi-assignee tasks**

Inside the row render, alongside the assignee avatars:

```jsx
{(() => {
  const { done, total } = completionProgress(task.task_assignees)
  if (total < 2) return null
  const full = done === total
  return (
    <span className={`badge ${full ? 'badge-green' : 'badge-muted'} ml-2`}>
      {done}/{total}
    </span>
  )
})()}
```

(Adjust class names to match what `badge-green` / `badge-muted` are in `src/index.css` — use whatever the existing UI calls the success and neutral chip colors.)

**Step 4: Manual smoke**

Run: `npm run dev` → My Tasks page. Multi-assignee tasks show `1/3` chip; single-assignee tasks don't.

**Step 5: Commit**

```bash
git add src/components/tasks/TaskTable.jsx
git commit -m "feat(tasks): progress chip on multi-assignee rows"
```

---

## Task 7 — Notify edge function: force_closed case

**Files:**
- Modify: `supabase/functions/notify/index.ts`

**Step 1: Read the file to understand current dispatch structure.**

Look for existing event handling (assigned / declined / completed / reassigned). The DB webhook fires on `task_audit_log` insert or on `tasks` update depending on current wiring — check which.

**Step 2: Add a case for `force_closed`**

Inside the event dispatch switch / if-chain, add a branch that:
- Triggers when the inserted audit row has `event_type = 'force_closed'`.
- Loads the task, assigner, and all assignees via the service-role client.
- Sends one Resend email per recipient (assignees + assigner), subject `"Task closed by {closer_name}: {task_title}"`.
- Body copy: "{Closer name} closed '{task_title}' for everyone. View: {app_url}/tasks/{id}"

Reuse the existing Resend helper in the file. Do NOT add a separate mailer — match the style of the existing `completed` case.

**Step 3: Configure the DB webhook (one-time, in Supabase dashboard)**

If `task_audit_log` isn't already a webhook source, add one: INSERT on `task_audit_log` → HTTP POST to the `notify` function URL. Filter for `event_type = 'force_closed'` in the function body (not the webhook filter, to stay simple).

If the webhook already covers `task_audit_log`, just add the function branch.

**Step 4: Deploy**

Run: `npx supabase functions deploy notify`
Expected: deploy succeeds.

**Step 5: Manual smoke**

Force-close a test task with 2 assignees + yourself as assigner. Confirm both assignees receive the email.

**Step 6: Commit**

```bash
git add supabase/functions/notify/index.ts
git commit -m "feat(email): force_closed notification to all assignees + assigner"
```

---

## Task 8 — Update CLAUDE.md + design doc status

**Files:**
- Modify: `CLAUDE.md` (append to the migrations section)
- Modify: `docs/plans/2026-04-23-task-improvements-design.md` (mark 044 shipped)

**Step 1: Add 044 entry to CLAUDE.md migrations section.**

Append after the 043 entry:

```markdown
- **044_per_assignee_completion.sql** — Adds `completed_at` / `completed_by` on `task_assignees`. Aggregate trigger flips `tasks.status='Done'` only when every assignee has `completed_at` set. RPC `force_close_task(tid)` lets assigner / admin / any assignee close a task for everyone (fills open rows + writes `force_closed` audit).
```

**Step 2: Mark 044 done in the design doc.**

In `docs/plans/2026-04-23-task-improvements-design.md`, add under the "Rollout" section a note: "044 shipped 2026-04-23" (use current date).

**Step 3: Commit**

```bash
git add CLAUDE.md docs/plans/2026-04-23-task-improvements-design.md
git commit -m "docs: document migration 044 — per-assignee completion"
```

---

## Wrap-up checklist

- [ ] Migration 044 applied on local + remote Supabase.
- [ ] `npm run test:run` passes.
- [ ] `npm run build` succeeds (catches any TS/lint regressions).
- [ ] Manual smoke test: single-assignee task unaffected, multi-assignee task marks individually, aggregate Done works, force-close works, email fires.
- [ ] CLAUDE.md reflects 044.

After all 8 tasks commit: rebase-check on `main`, then open PR `feat(tasks): per-assignee completion (044)` targeting `main` from `chatimprovements`, referencing `docs/plans/2026-04-23-task-improvements-design.md`.
