-- ─────────────────────────────────────────────
-- 056 · Task dependencies
-- Soft / display-only "Blocked by" + "Blocks" linkage between tasks.
-- No DB enforcement of status transitions; the UI shows a warning
-- toast when a user moves a task with open blockers, but never blocks
-- the action. v1 has no cycle detection — simple wins, can add later.
-- ─────────────────────────────────────────────

create table if not exists public.task_dependencies (
  blocker_id  uuid not null references public.tasks(id) on delete cascade,
  blocked_id  uuid not null references public.tasks(id) on delete cascade,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint task_dependencies_no_self check (blocker_id <> blocked_id)
);

-- The PK already indexes (blocker_id, blocked_id), which covers blocker-side
-- lookups. Add a complementary index for "blocked-by" lookups.
create index if not exists idx_task_dependencies_blocked_id
  on public.task_dependencies(blocked_id);

alter table public.task_dependencies enable row level security;

-- ─────────────────────────────────────────────
-- RLS — read requires visibility on BOTH endpoints (a row referencing a
-- task you can't see is information leakage). Insert requires both
-- endpoints visible AND created_by must match the caller. Delete is more
-- lenient: visibility on either endpoint is enough.
-- ─────────────────────────────────────────────
drop policy if exists "task_deps_select" on public.task_dependencies;
create policy "task_deps_select"
  on public.task_dependencies for select
  using (
    exists (select 1 from public.tasks where id = blocker_id)
    and exists (select 1 from public.tasks where id = blocked_id)
  );

drop policy if exists "task_deps_insert" on public.task_dependencies;
create policy "task_deps_insert"
  on public.task_dependencies for insert
  with check (
    auth.uid() = created_by
    and exists (select 1 from public.tasks where id = blocker_id)
    and exists (select 1 from public.tasks where id = blocked_id)
  );

drop policy if exists "task_deps_delete" on public.task_dependencies;
create policy "task_deps_delete"
  on public.task_dependencies for delete
  using (
    exists (select 1 from public.tasks where id = blocker_id)
    or exists (select 1 from public.tasks where id = blocked_id)
  );

-- Realtime so multiple panels viewing the same task stay in sync.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'task_dependencies'
  ) then
    alter publication supabase_realtime add table public.task_dependencies;
  end if;
end $$;

-- ─────────────────────────────────────────────
-- Audit: extend task_audit_log event_type CHECK with dependency events.
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
    'force_closed_with_open_subtasks',
    'dependency_added','dependency_removed'
  )) not valid;

-- Audit on insert/delete. Writes one row per event onto the BLOCKED task
-- (the one whose progress is gated). Matches user mental model: "this task
-- got a new blocker" / "this task lost a blocker".
create or replace function public.audit_task_dependency_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  blocker_title text;
begin
  if tg_op = 'INSERT' then
    select title into blocker_title from public.tasks where id = new.blocker_id;
    insert into public.task_audit_log
      (task_id, event_type, performed_by, old_value, new_value, note)
    values
      (new.blocked_id, 'dependency_added', new.created_by,
       null, new.blocker_id::text,
       coalesce('Blocked by: ' || blocker_title, 'Blocker added'));
    return new;
  end if;

  if tg_op = 'DELETE' then
    select title into blocker_title from public.tasks where id = old.blocker_id;
    insert into public.task_audit_log
      (task_id, event_type, performed_by, old_value, new_value, note)
    values
      (old.blocked_id, 'dependency_removed', auth.uid(),
       old.blocker_id::text, null,
       coalesce('Blocker removed: ' || blocker_title, 'Blocker removed'));
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_audit_task_dependency_change on public.task_dependencies;
create trigger trg_audit_task_dependency_change
  after insert or delete on public.task_dependencies
  for each row execute function public.audit_task_dependency_change();
