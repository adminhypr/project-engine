-- ─────────────────────────────────────────────
-- 053 · Sub-tasks
-- Adds parent_task_id self-FK on tasks. Sub-tasks are full task rows
-- (inherit chat, completion, RLS, audit). Parent auto-closes only when
-- every child is Done. Force-closing a parent leaves children open.
-- v1: single-level only (parent must itself have parent_task_id IS NULL).
-- ─────────────────────────────────────────────

alter table public.tasks
  add column if not exists parent_task_id uuid
    references public.tasks(id) on delete cascade;

create index if not exists idx_tasks_parent_task_id
  on public.tasks(parent_task_id) where parent_task_id is not null;

-- No self-parent.
alter table public.tasks
  drop constraint if exists tasks_no_self_parent;
alter table public.tasks
  add constraint tasks_no_self_parent
  check (parent_task_id is null or parent_task_id <> id);

-- ─────────────────────────────────────────────
-- Single-level guard: a parent may not itself be a child. Trigger
-- checks both directions on insert/update of parent_task_id. Cheaper
-- than recursive cycle detection and matches v1 product decision.
-- ─────────────────────────────────────────────
create or replace function public.guard_subtask_single_level()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_is_child boolean;
  has_children boolean;
begin
  if new.parent_task_id is null then
    return new;
  end if;

  -- Reject if the would-be parent is itself a sub-task.
  select (parent_task_id is not null)
    into parent_is_child
    from public.tasks
   where id = new.parent_task_id;

  if coalesce(parent_is_child, false) then
    raise exception 'sub-tasks may not be nested (parent % is itself a sub-task)', new.parent_task_id;
  end if;

  -- Reject if this row already has children (can't demote a parent into a child).
  select exists(select 1 from public.tasks where parent_task_id = new.id)
    into has_children;

  if has_children then
    raise exception 'task % has sub-tasks and cannot itself become a sub-task', new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_subtask_single_level on public.tasks;
create trigger trg_guard_subtask_single_level
  before insert or update of parent_task_id on public.tasks
  for each row execute function public.guard_subtask_single_level();

-- ─────────────────────────────────────────────
-- Audit: extend event_type CHECK with sub-task events.
-- ─────────────────────────────────────────────
alter table public.task_audit_log
  drop constraint if exists task_audit_log_event_type_check;
alter table public.task_audit_log
  add constraint task_audit_log_event_type_check
  check (event_type in (
    'task_created','status_changed','urgency_changed','due_date_changed',
    'notes_updated','reassigned','accepted','declined','assigner_override',
    'assignee_marked_done','assignee_unmarked','force_closed',
    'all_assignees_completed',
    'subtask_added','subtask_removed','parent_auto_closed_via_subtasks',
    'force_closed_with_open_subtasks'
  )) not valid;

-- ─────────────────────────────────────────────
-- Aggregate trigger: when a sub-task transitions to Done, check if all
-- siblings are Done — if so, cascade parent to Done and audit.
-- Mirrors aggregate_task_completion (044) pattern.
-- Skips when status didn't actually change to 'Done'.
-- ─────────────────────────────────────────────
create or replace function public.aggregate_parent_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total int;
  done  int;
  parent_status text;
begin
  if new.parent_task_id is null then return new; end if;

  -- Only react to a transition INTO Done. (Reopen path handled separately.)
  if (tg_op = 'UPDATE' and old.status is not distinct from new.status) then
    return new;
  end if;

  if new.status = 'Done' then
    select count(*), count(*) filter (where status = 'Done')
      into total, done
      from public.tasks
     where parent_task_id = new.parent_task_id;

    if total > 0 and total = done then
      select status into parent_status from public.tasks where id = new.parent_task_id;
      if parent_status is distinct from 'Done' then
        update public.tasks
           set status = 'Done'
         where id = new.parent_task_id and status <> 'Done';
        if found then
          insert into public.task_audit_log
            (task_id, event_type, performed_by, old_value, new_value, note)
          values
            (new.parent_task_id, 'parent_auto_closed_via_subtasks',
             auth.uid(), parent_status, 'Done',
             'All sub-tasks completed');
        end if;
      end if;
    end if;
  end if;

  -- Reopen path: a Done child went back to In Progress / etc. → reopen parent.
  if old.status = 'Done' and new.status <> 'Done' then
    update public.tasks
       set status = 'In Progress'
     where id = new.parent_task_id and status = 'Done';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_aggregate_parent_completion on public.tasks;
create trigger trg_aggregate_parent_completion
  after update of status on public.tasks
  for each row execute function public.aggregate_parent_completion();

-- ─────────────────────────────────────────────
-- subtask_added / subtask_removed audit on the parent.
-- Fires when a row is created with a parent or its parent_task_id changes.
-- ─────────────────────────────────────────────
create or replace function public.audit_subtask_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.parent_task_id is not null then
    insert into public.task_audit_log
      (task_id, event_type, performed_by, old_value, new_value, note)
    values
      (new.parent_task_id, 'subtask_added', auth.uid(),
       null, new.id::text, coalesce(new.title, ''));
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.parent_task_id is distinct from new.parent_task_id then
    if old.parent_task_id is not null then
      insert into public.task_audit_log
        (task_id, event_type, performed_by, old_value, new_value, note)
      values
        (old.parent_task_id, 'subtask_removed', auth.uid(),
         old.id::text, null, coalesce(new.title, old.title, ''));
    end if;
    if new.parent_task_id is not null then
      insert into public.task_audit_log
        (task_id, event_type, performed_by, old_value, new_value, note)
      values
        (new.parent_task_id, 'subtask_added', auth.uid(),
         null, new.id::text, coalesce(new.title, ''));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_audit_subtask_link on public.tasks;
create trigger trg_audit_subtask_link
  after insert or update of parent_task_id on public.tasks
  for each row execute function public.audit_subtask_link();

-- ─────────────────────────────────────────────
-- Extend force_close_task: if the task being force-closed has any open
-- sub-tasks, write an additional audit row tagging it. Children are
-- intentionally NOT cascaded — the design says force-close a parent
-- with open kids leaves the kids open.
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
  open_kids int;
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

  if prev_status is distinct from 'Done' then
    insert into public.task_audit_log
      (task_id, event_type, performed_by, old_value, new_value, note)
    values
      (tid, 'force_closed', caller, prev_status, 'Done', 'Closed for everyone');
  end if;

  -- Note open sub-tasks (children stay open by design).
  select count(*) into open_kids
    from public.tasks
   where parent_task_id = tid and status <> 'Done';

  if open_kids > 0 then
    insert into public.task_audit_log
      (task_id, event_type, performed_by, old_value, new_value, note)
    values
      (tid, 'force_closed_with_open_subtasks', caller,
       null, open_kids::text,
       open_kids::text || ' sub-task(s) left open');
  end if;
end;
$$;

grant execute on function public.force_close_task(uuid) to authenticated;
