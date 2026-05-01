-- ─────────────────────────────────────────────
-- 097 · Revert tasks_select to inline predicate (083 broke INSERT...RETURNING)
--
-- Real prod bug: every task creation fails with
--   42501: new row violates row-level security policy for table "tasks"
-- but the tasks_insert WITH CHECK clearly passes (any authenticated
-- non-external can insert).
--
-- Root cause: migration 083 replaced the inline tasks SELECT predicate
-- with `is_task_visible(id)`, which calls `can_user_see_task(p_user, p_task)`,
-- whose body wraps every clause in:
--   exists (select 1 from public.tasks t where t.id = p_task and (...))
--
-- The function is STABLE. For an INSERT...RETURNING, Postgres applies
-- the SELECT USING policy to the returned row — and STABLE functions
-- use the query's PRE-INSERT snapshot, which doesn't include the new
-- row. So the inner `select 1 from tasks where id = p_task` returns 0
-- rows even though the row was just inserted, the EXISTS is false,
-- the function returns false, the SELECT USING fails, PostgREST
-- surfaces this as "new row violates row-level security policy."
--
-- The frontend's `useTaskActions.assignTask` does
-- `supabase.from('tasks').insert(...).select().single()` — every call
-- hits this. Confirmed via impersonation: same INSERT works without
-- RETURNING, fails with RETURNING.
--
-- Fix: drop tasks_select and recreate the inline predicate from
-- migrations 011/039. Inline RLS expressions reference row columns
-- directly (assigned_to, assigned_by, team_id) — no need to look up
-- the row in the table → no snapshot issue.
--
-- Side effects:
--   • is_task_visible() and can_user_see_task() are kept (the 076
--     task-chat mention enrol trigger uses can_user_see_task; that
--     runs AFTER INSERT on dm_messages, not tasks, so no snapshot
--     issue there).
--   • The minor performance benefit of helper-cached results is lost
--     for the SELECT path — at typical scale (< 1M tasks) this is
--     negligible. If it ever matters, refactor to pass task columns
--     into the helper as parameters rather than the id.
-- ─────────────────────────────────────────────

drop policy if exists "tasks_select" on public.tasks;

-- Inline form, matching 039's predicate exactly. Reference columns
-- directly so the policy works against rows being returned from
-- INSERT...RETURNING (no STABLE-snapshot problem).
create policy "tasks_select" on public.tasks for select
  using (
    not public.is_external_user(auth.uid())
    and (
      -- Primary assignee.
      tasks.assigned_to = auth.uid()
      -- Assigner.
      or tasks.assigned_by = auth.uid()
      -- Secondary assignee via task_assignees junction.
      or exists (
        select 1 from public.task_assignees ta
         where ta.task_id = tasks.id
           and ta.profile_id = auth.uid()
      )
      or exists (
        select 1 from public.profiles p
         where p.id = auth.uid()
           and (
             -- Global Admin.
             p.role = 'Admin'
             -- Manager on the task's team (per-team role on profile_teams,
             -- Manager only — NOT TeamLeader).
             or exists (
               select 1 from public.profile_teams pt
                where pt.profile_id = auth.uid()
                  and pt.team_id = tasks.team_id
                  and pt.role = 'Manager'
             )
             -- Caller is global Manager/Admin AND the PRIMARY assignee
             -- (tasks.assigned_to) reports to them.
             or (
               p.role in ('Manager','Admin')
               and exists (
                 select 1 from public.profiles assignee
                  where assignee.id = tasks.assigned_to
                    and assignee.reports_to = auth.uid()
               )
             )
           )
      )
    )
  );
