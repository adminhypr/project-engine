-- ============================================================
-- Migration 007: Multi-team membership
-- Allows users to belong to multiple teams via junction table.
-- profiles.team_id is kept as "primary team" for backward compat.
-- ============================================================

-- ─────────────────────────────────────────────
-- PROFILE_TEAMS junction table
-- ─────────────────────────────────────────────
create table public.profile_teams (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (profile_id, team_id)
);

-- Only one primary team per profile
create unique index idx_profile_teams_primary
  on public.profile_teams (profile_id)
  where is_primary = true;

-- Fast lookup: which profiles are on a team?
create index idx_profile_teams_team_id on public.profile_teams(team_id);

-- ─────────────────────────────────────────────
-- Backfill from existing profiles.team_id
-- ─────────────────────────────────────────────
insert into public.profile_teams (profile_id, team_id, is_primary)
select id, team_id, true
from public.profiles
where team_id is not null
on conflict do nothing;

-- ─────────────────────────────────────────────
-- RLS for profile_teams
-- ─────────────────────────────────────────────
alter table public.profile_teams enable row level security;

create policy "Profile teams viewable by authenticated users"
  on public.profile_teams for select
  using (auth.role() = 'authenticated');

create policy "Admins can manage profile teams"
  on public.profile_teams for all
  using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'Admin'
    )
  );

-- ─────────────────────────────────────────────
-- Update task RLS: managers see tasks for ANY of their teams
-- ─────────────────────────────────────────────

-- Task SELECT
drop policy "Task visibility by role" on public.tasks;

create policy "Task visibility by role"
  on public.tasks for select
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'Admin'
        or (p.role = 'Manager' and exists (
          select 1 from public.profile_teams pt
          where pt.profile_id = p.id and pt.team_id = tasks.team_id
        ))
        or (p.role in ('Manager', 'Admin') and exists (
          select 1 from public.profiles assignee
          where assignee.id = tasks.assigned_to
          and assignee.reports_to = auth.uid()
        ))
      )
    )
  );

-- Task UPDATE
drop policy "Task update by role" on public.tasks;

create policy "Task update by role"
  on public.tasks for update
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'Admin'
        or (p.role = 'Manager' and exists (
          select 1 from public.profile_teams pt
          where pt.profile_id = p.id and pt.team_id = tasks.team_id
        ))
        or (p.role in ('Manager', 'Admin') and exists (
          select 1 from public.profiles assignee
          where assignee.id = tasks.assigned_to
          and assignee.reports_to = auth.uid()
        ))
      )
    )
  );

-- Task DELETE
drop policy "Task delete by role" on public.tasks;

create policy "Task delete by role"
  on public.tasks for delete
  using (
    assigned_to = auth.uid()
    or assigned_by = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and (
        p.role = 'Admin'
        or (p.role = 'Manager' and exists (
          select 1 from public.profile_teams pt
          where pt.profile_id = p.id and pt.team_id = tasks.team_id
        ))
      )
    )
  );

-- Comment visibility
drop policy "Comment visibility" on public.comments;

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
          where p.id = auth.uid()
          and (
            p.role = 'Admin'
            or (p.role = 'Manager' and exists (
              select 1 from public.profile_teams pt
              where pt.profile_id = p.id and pt.team_id = t.team_id
            ))
            or (p.role in ('Manager', 'Admin') and exists (
              select 1 from public.profiles assignee
              where assignee.id = t.assigned_to
              and assignee.reports_to = auth.uid()
            ))
          )
        )
      )
    )
  );

-- ─────────────────────────────────────────────
-- Enable realtime on profile_teams
-- ─────────────────────────────────────────────
alter publication supabase_realtime add table public.profile_teams;
