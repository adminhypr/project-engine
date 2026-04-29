-- ─────────────────────────────────────────────
-- 076 · Task-chat mention enrol: gate by task visibility
--
-- Migration 047's auto-enrol trigger force-adds any mentioned internal
-- user as a participant on a kind='task' conversation. That bypasses
-- the tasks SELECT RLS — a CEO mentioned in a task chat by a Staff user
-- who can't otherwise see the task gains read access to its entire chat
-- history (which often quotes the task body verbatim).
--
-- Fix: a SECURITY DEFINER STABLE helper `can_user_see_task` that mirrors
-- the tasks SELECT predicate from 011_multi_assignee.sql:71-98 as
-- amended by 039_agentboard_rls.sql:21-53. Externals never see tasks
-- (the 039 outer guard), so the helper returns false for them — which
-- preserves 047's "skip externals unless already a participant" path.
--
-- The 047 trigger is rewritten to call this helper before each insert.
-- ─────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- Helper: can_user_see_task(p_user, p_task)
--
-- Mirrors the live tasks SELECT predicate. Each clause cites the source
-- migration line so future audits can verify drift.
-- ─────────────────────────────────────────────
create or replace function public.can_user_see_task(p_user uuid, p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- 039: externals (Agent / Client) never see tasks. Hard outer guard.
    not public.is_external_user(p_user)
    and exists (
      select 1
        from public.tasks t
       where t.id = p_task
         and (
           -- 011:74 / 039:28 — primary assignee on tasks.assigned_to.
           t.assigned_to = p_user
           -- 011:75 / 039:29 — assigner.
           or t.assigned_by = p_user
           -- 011:76-79 / 039:30-33 — secondary assignee via task_assignees.
           or exists (
             select 1 from public.task_assignees ta
              where ta.task_id = t.id
                and ta.profile_id = p_user
           )
           or exists (
             select 1 from public.profiles p
              where p.id = p_user
                and (
                  -- 011:84 / 039:38 — global Admin.
                  p.role = 'Admin'
                  -- 011:85-90 / 039:39-44 — Manager on the task's team
                  --   (per-team role on profile_teams, NOT TeamLeader).
                  or exists (
                    select 1 from public.profile_teams pt
                     where pt.profile_id = p_user
                       and pt.team_id = t.team_id
                       and pt.role = 'Manager'
                  )
                  -- 011:91-95 / 039:45-49 — caller is global Manager/Admin
                  --   AND the PRIMARY assignee (tasks.assigned_to) reports
                  --   to them. Note: this checks the primary only, NOT all
                  --   secondary assignees, matching the live predicate.
                  or (
                    p.role in ('Manager','Admin')
                    and exists (
                      select 1 from public.profiles assignee
                       where assignee.id = t.assigned_to
                         and assignee.reports_to = p_user
                    )
                  )
                )
           )
         )
    )
$$;

revoke all on function public.can_user_see_task(uuid, uuid) from public;
grant execute on function public.can_user_see_task(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────
-- Replace the 047 trigger function with a visibility-gated version.
-- The trigger itself (trg_auto_enrol_task_chat_mentions) is unchanged
-- and still bound to this function name — only the body is rewritten.
-- ─────────────────────────────────────────────
create or replace function public.auto_enrol_mentioned_in_task_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_kind text;
  conv_task uuid;
  mentioned_id uuid;
  is_ext boolean;
begin
  select kind, task_id into conv_kind, conv_task
    from public.conversations where id = new.conversation_id;
  if conv_kind is distinct from 'task' or conv_task is null then
    return new;
  end if;

  if new.mentions is null or jsonb_typeof(new.mentions) <> 'array' then
    return new;
  end if;

  for mentioned_id in
    select (elem ->> 'user_id')::uuid
      from jsonb_array_elements(new.mentions) elem
     where elem ? 'user_id'
  loop
    if mentioned_id is null then continue; end if;

    -- Preserve 047 behavior: externals are skipped unless they're already
    -- a participant. (Externals also fail can_user_see_task below, so
    -- this branch is a no-op for new externals — kept for clarity.)
    select public.is_external_user(mentioned_id) into is_ext;
    if is_ext and not exists (
      select 1 from public.conversation_participants
       where conversation_id = new.conversation_id and user_id = mentioned_id
    ) then
      continue;
    end if;

    -- New gate: skip internal users who can't see the underlying task.
    -- Without this, a Staff user could grant any mentioned internal user
    -- read access to the task chat (which routinely quotes the task body).
    if not is_ext and not public.can_user_see_task(mentioned_id, conv_task) then
      continue;
    end if;

    -- Upsert with last_read_at slightly in the past so this message flags
    -- as unread for them immediately.
    insert into public.conversation_participants (conversation_id, user_id, last_read_at)
      values (new.conversation_id, mentioned_id, now() - interval '1 second')
      on conflict do nothing;
  end loop;

  return new;
end;
$$;
