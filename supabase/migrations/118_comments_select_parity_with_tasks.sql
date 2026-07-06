-- 118_comments_select_parity_with_tasks.sql
-- User report (2026-07-06): "not seeing comments on tasks they are viewing."
-- Root cause: the comments SELECT policy ("Comment visibility") predates two
-- task-visibility expansions and never got their branches:
--   * migration 011 — SECONDARY assignees via task_assignees
--   * migrations 106-108 — Dev Project members via is_project_member()
-- Reproduced live before this fix (Test Staff): sees task = 1, sees
-- comments = 0, for BOTH viewer classes.
--
-- Fix: recreate the task branch of comments SELECT as an exact mirror of the
-- live tasks_select predicate (read from prod 2026-07-06), keyed on
-- comments.task_id. Principle: if you can open the task, you can read its
-- comments. The card-comments policy (069/070) is untouched.
--
-- Pitfall pre-flight: inline EXISTS on OTHER tables (tasks/task_assignees/
-- profiles) from a comments policy — no self-reference, no recursion (#1).
-- is_project_member() is SECURITY DEFINER (verified live) and already used
-- inside tasks_select. No STABLE-snapshot issue (#9): the referenced rows
-- pre-exist any comment INSERT ... RETURNING.
-- Idempotent. Rollback: recreate the previous policy body (in git history).

drop policy if exists "Comment visibility" on public.comments;

create policy "Comment visibility"
  on public.comments for select
  using (
    task_id is not null
    and not public.is_external_user(auth.uid())
    and exists (
      select 1 from public.tasks t
      where t.id = comments.task_id
        and (
          t.assigned_to = auth.uid()
          or t.assigned_by = auth.uid()
          -- 011: secondary assignees
          or exists (
            select 1 from public.task_assignees ta
            where ta.task_id = t.id and ta.profile_id = auth.uid()
          )
          -- 106-108: Dev Project members see feature-card comments
          or (t.project_id is not null and public.is_project_member(t.project_id))
          or exists (
            select 1 from public.profiles p
            where p.id = auth.uid()
              and (
                p.role = 'Admin'
                or exists (
                  select 1 from public.profile_teams pt
                  where pt.profile_id = auth.uid()
                    and pt.team_id = t.team_id
                    and pt.role = 'Manager'
                )
                or (
                  p.role in ('Manager', 'Admin')
                  and exists (
                    select 1 from public.profiles assignee
                    where assignee.id = t.assigned_to
                      and assignee.reports_to = auth.uid()
                  )
                )
              )
          )
        )
    )
  );
