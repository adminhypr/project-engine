-- ============================================================
-- Project Engine — 003: Task Acceptance / Decline
-- Idempotent — safe to re-run
-- ============================================================

-- ─────────────────────────────────────────────
-- NEW COLUMNS on tasks (skip if already exist)
-- ─────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'tasks' and column_name = 'acceptance_status') then
    alter table public.tasks add column acceptance_status text not null default 'Accepted' check (acceptance_status in ('Accepted','Pending','Declined'));
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'tasks' and column_name = 'decline_reason') then
    alter table public.tasks add column decline_reason text;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'tasks' and column_name = 'accepted_at') then
    alter table public.tasks add column accepted_at timestamptz;
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'tasks' and column_name = 'declined_at') then
    alter table public.tasks add column declined_at timestamptz;
  end if;
end $$;

-- ─────────────────────────────────────────────
-- TRIGGER: Auto-set acceptance_status on INSERT
-- ─────────────────────────────────────────────
drop trigger if exists tasks_set_acceptance on public.tasks;

create or replace function public.set_acceptance_on_create()
returns trigger as $$
begin
  if new.assignment_type in ('Superior', 'Self') then
    new.acceptance_status = 'Accepted';
    new.accepted_at = now();
  else
    new.acceptance_status = 'Pending';
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger tasks_set_acceptance
  before insert on public.tasks
  for each row execute procedure public.set_acceptance_on_create();

-- ─────────────────────────────────────────────
-- TRIGGER: Log accepted/declined to audit log
-- ─────────────────────────────────────────────
drop trigger if exists tasks_audit_acceptance on public.tasks;

create or replace function public.audit_acceptance_change()
returns trigger as $$
begin
  if new.acceptance_status = 'Accepted' and old.acceptance_status = 'Pending' then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value)
    values (new.id, 'accepted', new.assigned_to, 'Pending', 'Accepted');
  end if;

  if new.acceptance_status = 'Declined' and old.acceptance_status = 'Pending' then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value, note)
    values (
      new.id,
      'declined',
      new.assigned_to,
      'Pending',
      'Declined',
      coalesce(new.decline_reason, 'No reason provided')
    );
  end if;

  if new.assigned_to is distinct from old.assigned_to
     and old.acceptance_status = 'Declined' then
    new.acceptance_status = 'Pending';
    new.decline_reason = null;
    new.accepted_at = null;
    new.declined_at = null;
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger tasks_audit_acceptance
  before update on public.tasks
  for each row execute procedure public.audit_acceptance_change();

-- ─────────────────────────────────────────────
-- INDEX
-- ─────────────────────────────────────────────
create index if not exists idx_tasks_acceptance on public.tasks(acceptance_status);
