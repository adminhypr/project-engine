-- ─────────────────────────────────────────────
-- 039 · Agentboard RLS hardening
--
-- Externals (Agent, Client) must not see any tasks, task_assignees, or
-- comments. They can only participate in conversations of kind='group'
-- with team_id set (team group chats). DM creation and custom-group
-- creation are blocked — though note that the existing conversation
-- RPCs (get_or_create_dm, create_custom_group) are SECURITY DEFINER
-- and bypass RLS; those RPCs must be updated separately to refuse
-- external callers (see companion TS-side gating). This migration
-- provides the DB-level guard for any direct INSERT path and all
-- SELECT / message-INSERT paths.
--
-- Helper used below: public.is_external_user(uid) from migration 038.
-- ─────────────────────────────────────────────

-- ============================================================
-- 1. tasks SELECT — preserve existing predicate from 011_multi_assignee.
--    Policy name: "Task visibility by role"
-- ============================================================
drop policy if exists "Task visibility by role" on public.tasks;

create policy "Task visibility by role"
  on public.tasks for select
  using (
    not public.is_external_user(auth.uid())
    and (
      assigned_to = auth.uid()
      or assigned_by = auth.uid()
      or exists (
        select 1 from public.task_assignees ta
        where ta.task_id = tasks.id and ta.profile_id = auth.uid()
      )
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
        and (
          p.role = 'Admin'
          or exists (
            select 1 from public.profile_teams pt
            where pt.profile_id = auth.uid()
            and pt.team_id = tasks.team_id
            and pt.role = 'Manager'
          )
          or (p.role in ('Manager','Admin') and exists (
            select 1 from public.profiles assignee
            where assignee.id = tasks.assigned_to
            and assignee.reports_to = auth.uid()
          ))
        )
      )
    )
  );

-- ============================================================
-- 2. task_assignees SELECT — preserve existing predicate from 011.
--    Policy name: "task_assignees_select"
--    Original predicate: auth.role() = 'authenticated'
-- ============================================================
drop policy if exists "task_assignees_select" on public.task_assignees;

create policy "task_assignees_select"
  on public.task_assignees for select
  using (
    not public.is_external_user(auth.uid())
    and auth.role() = 'authenticated'
  );

-- ============================================================
-- 3. comments SELECT — preserve existing predicate from 010_per_team_role.
--    Policy name: "Comment visibility"
-- ============================================================
drop policy if exists "Comment visibility" on public.comments;

create policy "Comment visibility"
  on public.comments for select
  using (
    not public.is_external_user(auth.uid())
    and exists (
      select 1 from public.tasks t
      where t.id = comments.task_id
      and (
        t.assigned_to = auth.uid()
        or t.assigned_by = auth.uid()
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
        or exists (
          select 1 from public.profiles assignee
          where assignee.id = t.assigned_to
            and assignee.reports_to = auth.uid()
            and exists (
              select 1 from public.profiles p
              where p.id = auth.uid() and p.role in ('Manager', 'Admin')
            )
        )
      )
    )
  );

-- ============================================================
-- 4. conversations SELECT — preserve existing participant check from 027
--    but restrict externals to team-group conversations only.
--    Policy name: "conversations_select_participant"
-- ============================================================
drop policy if exists "conversations_select_participant" on public.conversations;

create policy "conversations_select_participant"
  on public.conversations for select
  using (
    public.is_conversation_participant(id)
    and (
      not public.is_external_user(auth.uid())
      or (kind = 'group' and team_id is not null)
    )
  );

-- ============================================================
-- 5. conversations INSERT — block externals.
--    Note: 027 intentionally left conversations with no INSERT policy
--    (default-deny), so regular inserts are already blocked and creation
--    happens through SECURITY DEFINER RPCs. This explicit block is
--    defense-in-depth in case a future migration adds an INSERT policy.
-- ============================================================
drop policy if exists "conversations_insert_external_block" on public.conversations;

create policy "conversations_insert_external_block"
  on public.conversations for insert
  with check (
    not public.is_external_user(auth.uid())
  );

-- ============================================================
-- 6. dm_messages INSERT — preserve existing participant check from 027,
--    and restrict externals to team-group conversations only.
--    Original policy name: "dm_messages_insert_participant"
-- ============================================================
drop policy if exists "dm_messages_insert_participant" on public.dm_messages;

create policy "dm_messages_insert_participant"
  on public.dm_messages for insert
  with check (
    public.is_conversation_participant(conversation_id)
    and author_id = auth.uid()
    and (
      not public.is_external_user(auth.uid())
      or exists (
        select 1 from public.conversations c
        where c.id = conversation_id
          and c.kind = 'group'
          and c.team_id is not null
      )
    )
  );
