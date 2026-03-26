-- ============================================================
-- Migration 010: Per-team roles
-- Users can now have different roles per team (Staff/Manager).
-- Admin remains a global role on profiles.role.
-- profiles.role is auto-synced as the "effective role" (max
-- across all team roles), but never downgrades an Admin.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. Add role column to profile_teams
-- ─────────────────────────────────────────────
alter table public.profile_teams
  add column role text not null default 'Staff'
  check (role in ('Staff', 'Manager'));

-- ─────────────────────────────────────────────
-- 2. Backfill: Manager/Admin users get 'Manager' on all teams
-- ─────────────────────────────────────────────
update public.profile_teams pt
set role = 'Manager'
from public.profiles p
where pt.profile_id = p.id
  and p.role in ('Manager', 'Admin');

-- ─────────────────────────────────────────────
-- 3. Sync trigger: keep profiles.role = max(team roles)
--    Never touches Admins (Admin is global).
-- ─────────────────────────────────────────────
create or replace function sync_effective_role()
returns trigger as $$
declare
  target_id uuid;
  current_role text;
  max_team_role text;
begin
  target_id := coalesce(new.profile_id, old.profile_id);

  select role into current_role
  from public.profiles where id = target_id;

  -- Never downgrade an Admin
  if current_role = 'Admin' then
    return coalesce(new, old);
  end if;

  -- Compute max role across all team memberships
  select coalesce(
    max(case when pt.role = 'Manager' then 'Manager' else 'Staff' end),
    'Staff'
  ) into max_team_role
  from public.profile_teams pt
  where pt.profile_id = target_id;

  if max_team_role is distinct from current_role then
    update public.profiles set role = max_team_role where id = target_id;
  end if;

  return coalesce(new, old);
end;
$$ language plpgsql security definer;

create trigger trg_sync_effective_role
  after insert or update or delete on public.profile_teams
  for each row execute function sync_effective_role();

-- ─────────────────────────────────────────────
-- 4. Update RLS: tasks — use profile_teams.role for manager check
-- ─────────────────────────────────────────────

-- Task SELECT
drop policy if exists "Task visibility by role" on public.tasks;

create policy "Task visibility by role"
  on public.tasks for select
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'Admin'
    )
    or exists (
      select 1 from public.profile_teams pt
      where pt.profile_id = auth.uid()
        and pt.team_id = tasks.team_id
        and pt.role = 'Manager'
    )
    or exists (
      select 1 from public.profiles assignee
      where assignee.id = tasks.assigned_to
        and assignee.reports_to = auth.uid()
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role in ('Manager', 'Admin')
        )
    )
  );

-- Task UPDATE
drop policy if exists "Task update by role" on public.tasks;

create policy "Task update by role"
  on public.tasks for update
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'Admin'
    )
    or exists (
      select 1 from public.profile_teams pt
      where pt.profile_id = auth.uid()
        and pt.team_id = tasks.team_id
        and pt.role = 'Manager'
    )
    or exists (
      select 1 from public.profiles assignee
      where assignee.id = tasks.assigned_to
        and assignee.reports_to = auth.uid()
        and exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role in ('Manager', 'Admin')
        )
    )
  );

-- Task DELETE
drop policy if exists "Task delete by role" on public.tasks;

create policy "Task delete by role"
  on public.tasks for delete
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'Admin'
    )
    or exists (
      select 1 from public.profile_teams pt
      where pt.profile_id = auth.uid()
        and pt.team_id = tasks.team_id
        and pt.role = 'Manager'
    )
  );

-- ─────────────────────────────────────────────
-- 5. Update RLS: comments — same pattern
-- ─────────────────────────────────────────────
drop policy if exists "Comment visibility" on public.comments;

create policy "Comment visibility"
  on public.comments for select
  using (
    exists (
      select 1 from public.tasks t
      where t.id = comments.task_id
      and (
        t.assigned_to = auth.uid()
        or t.assigned_by = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.role = 'Admin'
        )
        or exists (
          select 1 from public.profile_teams pt
          where pt.profile_id = auth.uid()
            and pt.team_id = t.team_id
            and pt.role = 'Manager'
        )
        or exists (
          select 1 from public.profiles assignee
          where assignee.id = t.assigned_to
            and assignee.reports_to = auth.uid()
            and exists (
              select 1 from public.profiles p
              where p.id = auth.uid() and p.role in ('Manager', 'Admin')
            )
        )
      )
    )
  );

-- ─────────────────────────────────────────────
-- 6. Update RLS: profile_teams manager setup
--    Managers can only assign teams where they are Manager
-- ─────────────────────────────────────────────
drop policy if exists "Managers can setup unassigned users" on public.profile_teams;

create policy "Managers can setup unassigned users"
  on public.profile_teams for insert
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and p.role in ('Manager', 'Admin')
    )
    -- Target user must have no existing team assignments
    and not exists (
      select 1 from public.profile_teams existing
      where existing.profile_id = profile_teams.profile_id
    )
    -- Admin can assign any team; Manager needs Manager role on that team
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'Admin'
      )
      or exists (
        select 1 from public.profile_teams my_teams
        where my_teams.profile_id = auth.uid()
        and my_teams.team_id = profile_teams.team_id
        and my_teams.role = 'Manager'
      )
    )
  );

-- ─────────────────────────────────────────────
-- 7. Performance index for RLS manager checks
-- ─────────────────────────────────────────────
create index idx_profile_teams_role
  on public.profile_teams(team_id, role)
  where role = 'Manager';
