-- ─────────────────────────────────────────────
-- 050 · Audit + email quality fixes
--
-- Four quality fixes bundled here because they share the same
-- "task completion + audit + email" surface:
--
--   H-7   Task chat conversations (kind='task') were falling through
--         035's DM email branch, which mailed every participant on
--         every message. Extend enqueue_dm_email so 'task' conversations
--         follow the same mentions-only rule as 'group'.
--
--   H-9   044 added `assignee_marked_done` and `assignee_unmarked`
--         event types to the audit CHECK constraint but never wrote
--         a trigger that emits them. Add an AFTER UPDATE trigger on
--         task_assignees so the Activity Log gets per-person completion
--         events.
--
--   M-13  Force-close was producing both `all_assignees_completed`
--         AND `force_closed` audit rows. The aggregate trigger should
--         skip its audit write when app.force_close='on' (the GUC
--         force_close_task sets for its bulk UPDATE) so only the
--         force_closed row lands.
--
--   M-14  Manually flipping tasks.status to 'Done' via the dropdown
--         fires 045's back-fill, but 045 never wrote an audit row for
--         the summary event. The Activity Log for a dropdown-done task
--         only had `status_changed`. Write an `all_assignees_completed`
--         entry when 045 actually fills assignees. Audit is now
--         symmetric across tick-last, force-close, and dropdown-done.
-- ─────────────────────────────────────────────


-- ─────────────────────────────────────────────
-- Part A · H-7: Task chat emails are mentions-only
-- Extends 035's enqueue_dm_email so conversations with kind='task'
-- follow the same rule as kind='group' (email only users whose id
-- appears in new.mentions). 1:1 DMs keep their original behavior.
-- ─────────────────────────────────────────────
create or replace function public.enqueue_dm_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_kind text;
begin
  if new.kind <> 'user' then return new; end if;

  select kind into conv_kind
    from public.conversations
    where id = new.conversation_id;

  if conv_kind in ('group', 'task') then
    -- Groups AND task chats: only email users whose id appears in new.mentions.
    -- mentions jsonb shape: [{ user_id, display_name }, ...]
    insert into public.pending_dm_emails (message_id, conversation_id, recipient_id)
      select new.id, new.conversation_id, cp.user_id
      from public.conversation_participants cp
      where cp.conversation_id = new.conversation_id
        and cp.user_id <> new.author_id
        and cp.muted = false
        and exists (
          select 1
          from jsonb_array_elements(coalesce(new.mentions, '[]'::jsonb)) m
          where (m->>'user_id')::uuid = cp.user_id
        );
  else
    -- 1:1 DMs: original behavior unchanged.
    insert into public.pending_dm_emails (message_id, conversation_id, recipient_id)
      select new.id, new.conversation_id, cp.user_id
      from public.conversation_participants cp
      where cp.conversation_id = new.conversation_id
        and cp.user_id <> new.author_id
        and cp.muted = false;
  end if;

  return new;
end;
$$;


-- ─────────────────────────────────────────────
-- Part B · H-9: Assignee completion audit triggers
-- AFTER UPDATE on task_assignees; writes one audit row per
-- completed_at transition. Includes the assignee's display name in
-- the note so the Activity Log UI can render
-- "Alice marked herself done".
-- ─────────────────────────────────────────────
create or replace function public.audit_assignee_completion_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assignee_name text;
begin
  if old.completed_at is not distinct from new.completed_at then
    return new;
  end if;

  select full_name into assignee_name
    from public.profiles
    where id = new.profile_id;

  if old.completed_at is null and new.completed_at is not null then
    insert into public.task_audit_log
      (task_id, event_type, performed_by, old_value, new_value, note)
    values
      (new.task_id, 'assignee_marked_done',
       coalesce(new.completed_by, auth.uid()),
       null, 'done',
       coalesce(assignee_name, 'Someone') || ' marked themselves done');
  elsif old.completed_at is not null and new.completed_at is null then
    insert into public.task_audit_log
      (task_id, event_type, performed_by, old_value, new_value, note)
    values
      (new.task_id, 'assignee_unmarked',
       coalesce(auth.uid(), new.profile_id),
       'done', null,
       coalesce(assignee_name, 'Someone') || ' unmarked themselves');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_audit_assignee_completion_change on public.task_assignees;
create trigger trg_audit_assignee_completion_change
  after update on public.task_assignees
  for each row execute function public.audit_assignee_completion_change();


-- ─────────────────────────────────────────────
-- Part C · M-13: Force-close audit dedup
-- Replaces 044's aggregate_task_completion so it skips its
-- all_assignees_completed audit write when app.force_close='on'.
-- The tasks.status flip still happens (otherwise force_close_task's
-- own UPDATE would race the trigger, depending on order). Only the
-- audit row is suppressed so force_close_task owns the audit.
-- Unmark-reopens branch preserved verbatim from 044.
-- ─────────────────────────────────────────────
create or replace function public.aggregate_task_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total int;
  done  int;
begin
  -- Only react when completed_at actually transitioned.
  if (tg_op = 'UPDATE'
      and (old.completed_at is not distinct from new.completed_at)) then
    return new;
  end if;

  select count(*), count(*) filter (where completed_at is not null)
    into total, done
    from public.task_assignees
   where task_id = new.task_id;

  -- During force_close_task, skip the aggregate audit to avoid duplicating
  -- the force_closed event. force_close_task sets app.force_close='on'
  -- for the duration of its bulk UPDATE. The status flip still happens
  -- so downstream triggers see Done; only the summary audit is skipped.
  if coalesce(current_setting('app.force_close', true), '') = 'on' then
    update public.tasks
       set status = 'Done'
     where id = new.task_id and status <> 'Done';
    return new;
  end if;

  -- Mark-complete path: all assignees done → flip to Done.
  if old.completed_at is null and new.completed_at is not null
     and total > 0 and total = done then
    update public.tasks
       set status = 'Done'
     where id = new.task_id and status <> 'Done';
    if found then
      -- Note event only. audit_task_updated (from 012) writes the
      -- matching 'status_changed' row.
      insert into public.task_audit_log
        (task_id, event_type, performed_by, old_value, new_value, note)
      values
        (new.task_id, 'all_assignees_completed', new.completed_by, null, null,
         'All assignees completed');
    end if;
  end if;

  -- Unmark path: previously all-done, now someone is open again → reopen.
  if old.completed_at is not null and new.completed_at is null
     and total > 0 and done < total then
    update public.tasks
       set status = 'In Progress'
     where id = new.task_id and status = 'Done';
    -- audit_task_updated writes the status_changed row for us.
  end if;

  return new;
end;
$$;


-- ─────────────────────────────────────────────
-- Part D · M-14: 045 emits audit when it back-fills
-- Replaces 045's sync_assignees_on_task_done so that when the
-- dropdown-done path actually back-fills open assignees, it writes
-- an `all_assignees_completed` audit row. Makes the Activity Log
-- symmetric across all three closure paths:
--   tick-last      → aggregate_task_completion writes it
--   force-close    → force_close_task writes force_closed
--   dropdown-done  → sync_assignees_on_task_done writes it (this)
-- The existing app.force_close GUC set + UPDATE logic is preserved.
-- ─────────────────────────────────────────────
create or replace function public.sync_assignees_on_task_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rows_filled int;
begin
  if new.status = 'Done' and old.status is distinct from 'Done' then
    -- Bypass the per-row self-update guard; this is a task-level close
    -- initiated by a legitimate tasks UPDATE that already passed tasks RLS.
    perform set_config('app.force_close', 'on', true);

    update public.task_assignees
       set completed_at = now(),
           completed_by = coalesce(auth.uid(), new.assigned_by)
     where task_id = new.id
       and completed_at is null;

    get diagnostics rows_filled = row_count;

    if rows_filled > 0 then
      insert into public.task_audit_log
        (task_id, event_type, performed_by, old_value, new_value, note)
      values
        (new.id, 'all_assignees_completed',
         coalesce(auth.uid(), new.assigned_by),
         null, null,
         'Auto-filled ' || rows_filled || ' assignee(s) on manual close');
    end if;
  end if;
  return new;
end;
$$;
