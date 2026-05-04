-- ─────────────────────────────────────────────
-- 100 · Cross-table RLS audit fixes — parent-visibility delegation
--
-- Audit 2026-05-04 (post-099) found 7 latent RLS bugs of two shapes:
--
--   (a) Policy gates on `auth.role() = 'authenticated'` where it should
--       delegate to PARENT visibility. Cross-team leak / privilege esc.
--   (b) Policy uses denormalized `profiles.team_id` where multi-team
--       Manager check via `profile_teams` was needed (regression of
--       migration 007 that was missed in this table).
--
-- Same shapes 099 closed for hub_members / hub_mentions /
-- task_recurrence_assignees. None reported in prod yet; surfaced by
-- a systematic cross-table audit, not a user report.
--
-- Fixes in this migration:
--
--   C1  task_audit_log SELECT          — multi-team Manager via profile_teams
--   C2  task_assignees SELECT          — delegate to parent task visibility
--   C3  task_assignees INSERT          — gate to assigner / primary / Admin / Manager
--   C4  comments INSERT (task branch)  — require visibility on parent task
--   H2  task_attachments INSERT (row)  — require visibility on parent task
--   H4  task_dependencies SELECT/INSERT/DELETE — delegate to parent task visibility
--   H5  task_recurrence_assignees SELECT, task_recurrence_audit SELECT —
--       delegate to parent recurrence visibility (matches task_recurrences_select)
--
-- Implementation notes:
--
--   * Uses `public.can_user_see_task(auth.uid(), <task_id>)` for C2/C3/C4/H2/H4.
--     Helper is from 076 (kept after 097 reverted `is_task_visible` from tasks
--     SELECT). 097's INSERT-RETURNING bug does NOT apply here — that bug was
--     specific to `tasks` SELECT calling a STABLE helper that read from `tasks`
--     itself during the snapshot phase. These policies are on different tables.
--
--   * task_assignees SELECT (C2) ALSO adds `profile_id = auth.uid()` as a first
--     OR branch. Reason: same shape as 099's hub_members fix — the just-inserted
--     row must be visible to the inserter via INSERT-RETURNING, even if
--     can_user_see_task() reads a pre-INSERT snapshot of task_assignees in its
--     assignee-via-junction branch.
--
--   * task_recurrence_audit / task_recurrence_assignees SELECT inline the same
--     predicate as task_recurrences_select rather than introducing a helper.
--     Two call sites; not worth a function.
-- ─────────────────────────────────────────────


-- C1 ─────────────────────────────────────────────
-- task_audit_log SELECT: replace the 002 inline predicate (which used
-- denormalized `profiles.team_id`, breaking multi-team Manager) with
-- `can_user_see_task`. Same delegation 010 applied to comments.
--
-- This also picks up two paths the 002 policy was missing entirely:
-- secondary assignees (via task_assignees) and Manager-of-direct-report
-- (via profiles.reports_to). Those gaps existed since 011 / 004.
-- ─────────────────────────────────────────────

drop policy if exists "Audit log readable by authenticated users" on public.task_audit_log;

create policy "Audit log readable by authenticated users"
  on public.task_audit_log for select
  using (public.can_user_see_task(auth.uid(), task_audit_log.task_id));


-- C2 ─────────────────────────────────────────────
-- task_assignees SELECT: was permissive (any authenticated non-external).
-- Delegate to parent task visibility instead. Add own-row escape so the
-- inserter (or new assignee on auto-acceptance UPDATE) sees their row
-- via INSERT/UPDATE-RETURNING regardless of STABLE-snapshot timing.
-- ─────────────────────────────────────────────

drop policy if exists "task_assignees_select" on public.task_assignees;

create policy "task_assignees_select"
  on public.task_assignees for select
  using (
    not coalesce(public.is_external_user(auth.uid()), false)
    and (
      -- Own assignment row — escapes any STABLE-snapshot edge case
      -- on INSERT/UPDATE-RETURNING (mirrors 099's hub_members fix).
      task_assignees.profile_id = auth.uid()
      -- Otherwise must be able to see the parent task.
      or public.can_user_see_task(auth.uid(), task_assignees.task_id)
    )
  );


-- C3 ─────────────────────────────────────────────
-- task_assignees INSERT: was permissive (any authenticated non-external
-- could insert an assignee row pointing to ANY task). Tighten to
-- assigner / primary assignee / Admin / Manager-on-team — matches the
-- DELETE-task permission set from 010.
--
-- The spawn-recurring-tasks cron path is unaffected: spawn_recurrence()
-- (079) is SECURITY DEFINER and bypasses RLS.
-- ─────────────────────────────────────────────

drop policy if exists "task_assignees_insert" on public.task_assignees;

create policy "task_assignees_insert"
  on public.task_assignees for insert
  with check (
    not coalesce(public.is_external_user(auth.uid()), false)
    and exists (
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
  );


-- C4 ─────────────────────────────────────────────
-- comments INSERT (task branch): was permissive — any authenticated user
-- could insert a comment on any task_id. The post-INSERT SELECT would
-- fail (Comment visibility gates on task visibility), so the inserter
-- couldn't see their own row, but legitimate task watchers WOULD see
-- the spam comment + receive bell/email notifications. Spam vector.
--
-- Add task-visibility gate. Card branch (comments_insert_card_member,
-- migration 069) is unchanged — it already gates on hub membership.
-- ─────────────────────────────────────────────

drop policy if exists "Authenticated users can post comments" on public.comments;

create policy "Authenticated users can post comments"
  on public.comments for insert
  with check (
    task_id is not null
    and auth.role() = 'authenticated'
    and author_id = auth.uid()
    and public.can_user_see_task(auth.uid(), comments.task_id)
  );


-- H2 ─────────────────────────────────────────────
-- task_attachments INSERT (DB row, not storage bucket): was permissive.
-- Storage bucket policies (049) already gate on auth.uid() prefix, but
-- the DB row was uncontrolled. Add task-visibility gate to match.
-- ─────────────────────────────────────────────

drop policy if exists "Authenticated users can add attachments" on public.task_attachments;

create policy "Authenticated users can add attachments"
  on public.task_attachments for insert
  with check (
    auth.role() = 'authenticated'
    and uploaded_by = auth.uid()
    and public.can_user_see_task(auth.uid(), task_attachments.task_id)
  );


-- H4 ─────────────────────────────────────────────
-- task_dependencies SELECT/INSERT/DELETE: gates on "tasks exist" instead
-- of "user can see tasks". Leaks dependency edges across visibility.
-- Replace with can_user_see_task for both endpoints.
-- ─────────────────────────────────────────────

drop policy if exists "task_deps_select" on public.task_dependencies;

create policy "task_deps_select"
  on public.task_dependencies for select
  using (
    public.can_user_see_task(auth.uid(), blocker_id)
    and public.can_user_see_task(auth.uid(), blocked_id)
  );

drop policy if exists "task_deps_insert" on public.task_dependencies;

create policy "task_deps_insert"
  on public.task_dependencies for insert
  with check (
    auth.uid() = created_by
    and public.can_user_see_task(auth.uid(), blocker_id)
    and public.can_user_see_task(auth.uid(), blocked_id)
  );

drop policy if exists "task_deps_delete" on public.task_dependencies;

create policy "task_deps_delete"
  on public.task_dependencies for delete
  using (
    public.can_user_see_task(auth.uid(), blocker_id)
    or public.can_user_see_task(auth.uid(), blocked_id)
  );


-- H5 ─────────────────────────────────────────────
-- task_recurrence_assignees SELECT and task_recurrence_audit SELECT:
-- both gate on "the parent recurrence exists" instead of "the user can
-- see it". Leaks template content across teams.
--
-- Inline the same predicate as task_recurrences_select (058+061):
-- Admin / creator / Manager-or-TeamLeader-on-team.
-- ─────────────────────────────────────────────

drop policy if exists "task_recurrence_assignees_select" on public.task_recurrence_assignees;

create policy "task_recurrence_assignees_select"
  on public.task_recurrence_assignees for select
  using (
    exists (
      select 1 from public.task_recurrences r
      where r.id = recurrence_id
        and (
          exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'Admin'
          )
          or r.created_by = auth.uid()
          or (r.team_id is not null and exists (
            select 1 from public.profile_teams pt
            where pt.profile_id = auth.uid()
              and pt.team_id = r.team_id
              and pt.role in ('Manager','TeamLeader')
          ))
        )
    )
  );

drop policy if exists "task_recurrence_audit_select" on public.task_recurrence_audit;

create policy "task_recurrence_audit_select"
  on public.task_recurrence_audit for select
  using (
    exists (
      select 1 from public.task_recurrences r
      where r.id = recurrence_id
        and (
          exists (
            select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'Admin'
          )
          or r.created_by = auth.uid()
          or (r.team_id is not null and exists (
            select 1 from public.profile_teams pt
            where pt.profile_id = auth.uid()
              and pt.team_id = r.team_id
              and pt.role in ('Manager','TeamLeader')
          ))
        )
    )
  );
