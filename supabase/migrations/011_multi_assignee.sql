-- ============================================================
-- Migration 011: Multiple assignees per task
-- Adds task_assignees junction table. tasks.assigned_to is kept
-- as the "primary assignee" for backward compatibility.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. Junction table
-- ─────────────────────────────────────────────
create table public.task_assignees (
  task_id    uuid not null references public.tasks(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (task_id, profile_id)
);

create index idx_task_assignees_profile on public.task_assignees(profile_id);
create index idx_task_assignees_task    on public.task_assignees(task_id);

-- ─────────────────────────────────────────────
-- 2. Backfill from existing tasks
-- ─────────────────────────────────────────────
insert into public.task_assignees (task_id, profile_id, is_primary)
select id, assigned_to, true
from public.tasks
where assigned_to is not null
on conflict do nothing;

-- ─────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────
alter table public.task_assignees enable row level security;

-- Visible to anyone who can see the parent task
create policy "task_assignees_select"
  on public.task_assignees for select
  using (auth.role() = 'authenticated');

-- Authenticated users can insert (task creation handles this)
create policy "task_assignees_insert"
  on public.task_assignees for insert
  with check (auth.role() = 'authenticated');

-- Delete: admin, task assigner, or the assignee themselves
create policy "task_assignees_delete"
  on public.task_assignees for delete
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.tasks t
      where t.id = task_assignees.task_id
      and t.assigned_by = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'Admin'
    )
  );

-- ─────────────────────────────────────────────
-- 4. Update task visibility RLS to include secondary assignees
-- ─────────────────────────────────────────────

-- We need to drop and recreate the task SELECT policy
-- (from 010 or earlier) to add the task_assignees check.
-- The current policy name may vary — drop all known versions.
drop policy if exists "Task visibility by role" on public.tasks;
drop policy if exists "task_visibility_with_per_team_roles" on public.tasks;

create policy "Task visibility by role"
  on public.tasks for select
  using (
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
  );

-- Same for task UPDATE
drop policy if exists "Task update by role" on public.tasks;
drop policy if exists "task_update_with_per_team_roles" on public.tasks;

create policy "Task update by role"
  on public.tasks for update
  using (
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
      )
    )
  );

-- ─────────────────────────────────────────────
-- 5. Enable realtime
-- ─────────────────────────────────────────────
alter publication supabase_realtime add table public.task_assignees;
