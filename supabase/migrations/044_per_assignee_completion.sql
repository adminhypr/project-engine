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
