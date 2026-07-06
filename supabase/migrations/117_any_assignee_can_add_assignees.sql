-- 117_any_assignee_can_add_assignees.sql
-- Product change (Ian, 2026-07-06): EVERY assignee on a task may invite
-- other people onto it. Previously (100 C3) task_assignees INSERT allowed
-- only assigner / PRIMARY assignee / Admin / Manager-on-team, so secondary
-- assignees (added via task_assignees) could not add anyone.
--
-- Pitfall pre-flight (memory: migration_pitfalls):
--   #1  "is caller an assignee?" inside a task_assignees policy is a
--       self-referential subquery -> 42P17 recursion at PLAN time. Use a
--       SECURITY DEFINER STABLE helper (same pattern as 093/103).
--   #9  helper reads PRE-EXISTING rows (the caller's own assignee row), not
--       the row being inserted -> INSERT ... RETURNING snapshot is safe
--       (and the app's addAssignee doesn't use RETURNING anyway).
--   Live policy body was read from prod 2026-07-06 and matches 100 —
--   no drift; this recreation preserves it exactly + one new branch.
-- Idempotent. Rollback: drop the helper + re-run migration 100's C3 block.

create or replace function public.is_task_assignee(p_task uuid, p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.task_assignees ta
    where ta.task_id = p_task and ta.profile_id = p_user
  );
$$;

revoke all on function public.is_task_assignee(uuid, uuid) from public;
grant execute on function public.is_task_assignee(uuid, uuid) to authenticated;

drop policy if exists "task_assignees_insert" on public.task_assignees;

create policy "task_assignees_insert"
  on public.task_assignees for insert
  with check (
    not coalesce(public.is_external_user(auth.uid()), false)
    and (
      -- NEW: any current assignee of the task can add people to it.
      public.is_task_assignee(task_assignees.task_id, auth.uid())
      or exists (
        select 1 from public.tasks t
        where t.id = task_assignees.task_id
          and (
            t.assigned_by = auth.uid()
            or t.assigned_to = auth.uid()
            or exists (
              select 1 from public.profiles p
              where p.id = auth.uid() and p.role = 'Admin'
            )
            or exists (
              select 1 from public.profile_teams pt
              where pt.profile_id = auth.uid()
                and pt.team_id = t.team_id
                and pt.role = 'Manager'
            )
          )
      )
    )
  );
