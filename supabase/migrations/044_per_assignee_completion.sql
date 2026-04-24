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
    'assignee_marked_done','assignee_unmarked','force_closed',
    'all_assignees_completed'
  )) not valid;

-- ─────────────────────────────────────────────
-- Aggregate trigger: if every assignee on a task now has completed_at,
-- flip tasks.status to 'Done' and write one audit entry. Uses AFTER
-- UPDATE on task_assignees so the row's new state is visible to the
-- count query.
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
  prev_status text;
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

  -- Tell guard_task_assignee_self_update we're in a legitimate force-close
  -- bulk update (scoped to this transaction; auto-resets on COMMIT/ROLLBACK).
  perform set_config('app.force_close', 'on', true);

  select status into prev_status from public.tasks where id = tid;

  update public.task_assignees
     set completed_at = now(),
         completed_by = caller
   where task_id = tid
     and completed_at is null;

  update public.tasks
     set status = 'Done'
   where id = tid and status <> 'Done';

  -- Audit based on prev_status, not FOUND: the aggregate AFTER trigger on
  -- task_assignees may have already flipped status to 'Done' (making the
  -- UPDATE above a no-op and FOUND false). We still want the force_closed
  -- audit row so notify/ can detect force-close and email everyone.
  if prev_status is distinct from 'Done' then
    insert into public.task_audit_log
      (task_id, event_type, performed_by, old_value, new_value, note)
    values
      (tid, 'force_closed', caller, prev_status, 'Done', 'Closed for everyone');
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

-- ─────────────────────────────────────────────
-- Self-update guard: RLS lets an assignee update their own row, but
-- can't restrict which columns. This trigger enforces that self-
-- updates may only touch completed_at / completed_by. Admin and the
-- task's assigner bypass (they may legitimately change other fields).
-- Service-role calls (auth.uid() is null) bypass.
-- ─────────────────────────────────────────────
create or replace function public.guard_task_assignee_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  is_admin_caller boolean;
  is_assigner boolean;
begin
  -- force_close_task sets this GUC (txn-scoped) before its bulk UPDATE so
  -- the per-row guard doesn't reject rows belonging to other assignees.
  -- Placed BEFORE the service-role bypass so it applies regardless of
  -- auth.uid() state. `true` third arg to current_setting returns NULL
  -- instead of erroring when the setting is absent.
  if coalesce(current_setting('app.force_close', true), '') = 'on' then
    return new;
  end if;

  if me is null then return new; end if;

  select (role = 'Admin') into is_admin_caller
    from public.profiles where id = me;
  select exists(select 1 from public.tasks
                where id = new.task_id and assigned_by = me)
    into is_assigner;

  if coalesce(is_admin_caller, false) or is_assigner then
    return new;
  end if;

  if me <> new.profile_id then
    raise exception 'cannot update another assignee row';
  end if;

  if new.task_id    is distinct from old.task_id
     or new.profile_id is distinct from old.profile_id
     or new.is_primary is distinct from old.is_primary
     or new.created_at is distinct from old.created_at
  then
    raise exception 'self-update restricted to completion fields';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_task_assignee_self_update on public.task_assignees;
create trigger trg_guard_task_assignee_self_update
  before update on public.task_assignees
  for each row execute function public.guard_task_assignee_self_update();
