-- ============================================================
-- Project Engine — 002: Task Audit Log
-- Run this in the Supabase SQL Editor after 001_initial.sql
-- ============================================================

-- ─────────────────────────────────────────────
-- AUDIT LOG TABLE
-- ─────────────────────────────────────────────
create table public.task_audit_log (
  id           uuid primary key default uuid_generate_v4(),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  event_type   text not null,
  performed_by uuid references public.profiles(id),
  old_value    text,
  new_value    text,
  note         text,
  created_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────
create index idx_audit_task_id    on public.task_audit_log(task_id);
create index idx_audit_event_type on public.task_audit_log(event_type);
create index idx_audit_created_at on public.task_audit_log(created_at);
create index idx_audit_performed  on public.task_audit_log(performed_by);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- Read-only for authenticated users
-- Writable only by service role (via triggers)
-- ─────────────────────────────────────────────
alter table public.task_audit_log enable row level security;

-- Anyone authenticated can read audit logs for tasks they can see
create policy "Audit log readable by authenticated users"
  on public.task_audit_log for select
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_audit_log.task_id
      and (
        t.assigned_to = auth.uid()
        or t.assigned_by = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
          and (
            p.role = 'Admin'
            or (p.role = 'Manager' and p.team_id = t.team_id)
          )
        )
      )
    )
  );

-- No insert/update/delete policies for anon/authenticated
-- Only service role (triggers running as SECURITY DEFINER) can write

-- ─────────────────────────────────────────────
-- TRIGGER: Log task creation
-- ─────────────────────────────────────────────
create or replace function public.audit_task_created()
returns trigger as $$
begin
  insert into public.task_audit_log (task_id, event_type, performed_by, new_value, note)
  values (
    new.id,
    'task_created',
    new.assigned_by,
    new.status,
    'Task "' || left(new.title, 80) || '" assigned to ' || (select full_name from public.profiles where id = new.assigned_to)
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger audit_on_task_created
  after insert on public.tasks
  for each row execute procedure public.audit_task_created();

-- ─────────────────────────────────────────────
-- TRIGGER: Log task updates (status, urgency, due_date, notes)
-- ─────────────────────────────────────────────
create or replace function public.audit_task_updated()
returns trigger as $$
begin
  -- Status changed
  if new.status is distinct from old.status then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value)
    values (new.id, 'status_changed', null, old.status, new.status);
  end if;

  -- Urgency changed
  if new.urgency is distinct from old.urgency then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value)
    values (new.id, 'urgency_changed', null, old.urgency, new.urgency);
  end if;

  -- Due date changed
  if new.due_date is distinct from old.due_date then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value)
    values (
      new.id,
      'due_date_changed',
      null,
      case when old.due_date is not null then old.due_date::text else 'none' end,
      case when new.due_date is not null then new.due_date::text else 'removed' end
    );
  end if;

  -- Notes updated
  if new.notes is distinct from old.notes then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value)
    values (new.id, 'notes_updated', null, left(coalesce(old.notes, ''), 100), left(coalesce(new.notes, ''), 100));
  end if;

  -- Reassigned (assigned_to changed)
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.task_audit_log (task_id, event_type, performed_by, old_value, new_value, note)
    values (
      new.id,
      'reassigned',
      null,
      (select full_name from public.profiles where id = old.assigned_to),
      (select full_name from public.profiles where id = new.assigned_to),
      'Reassigned from ' || coalesce((select full_name from public.profiles where id = old.assigned_to), 'unknown') ||
      ' to ' || coalesce((select full_name from public.profiles where id = new.assigned_to), 'unknown')
    );
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger audit_on_task_updated
  after update on public.tasks
  for each row execute procedure public.audit_task_updated();

-- ─────────────────────────────────────────────
-- ENABLE REALTIME on audit log (optional, for live updates)
-- ─────────────────────────────────────────────
alter publication supabase_realtime add table public.task_audit_log;
