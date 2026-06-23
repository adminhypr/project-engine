-- 105_task_archives.sql
-- Personal, per-viewer task archive. Archiving a task hides it only from the
-- archiving user's lists; collaborators (assigner, other assignees, managers)
-- still see it active. This is a side-table by design: it never writes to
-- `tasks`, so it can't trip the 042 self-update guard, sync_effective_role, or
-- any task-visibility predicate. Unarchive = delete the row.

create table if not exists public.task_archives (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  task_id     uuid not null references public.tasks(id)    on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

alter table public.task_archives enable row level security;

-- Every policy is scoped to the caller's own rows. No manager/admin escalation:
-- archive is purely personal, so there is nothing cross-user to read or write.
create policy "task_archives_select" on public.task_archives
  for select using (user_id = auth.uid());

create policy "task_archives_insert" on public.task_archives
  for insert with check (user_id = auth.uid());

create policy "task_archives_delete" on public.task_archives
  for delete using (user_id = auth.uid());
