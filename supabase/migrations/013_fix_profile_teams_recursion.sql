-- Fix: "infinite recursion detected in policy for relation profile_teams"
--
-- The "Managers can setup unassigned users" INSERT policy on profile_teams
-- queries profile_teams itself (to check existing memberships and manager's
-- own teams), which triggers RLS evaluation again → infinite loop.
--
-- Solution: extract the self-referencing checks into SECURITY DEFINER
-- functions that bypass RLS, then call those from the policy.

-- 1. Helper: does this user already have any team assignments?
create or replace function public.user_has_teams(p_profile_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profile_teams
    where profile_id = p_profile_id
  );
$$;

-- 2. Helper: does the current user have Manager role on a given team?
create or replace function public.is_manager_on_team(p_team_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profile_teams
    where profile_id = auth.uid()
    and team_id = p_team_id
    and role = 'Manager'
  );
$$;

-- 3. Replace the recursive policy
drop policy if exists "Managers can setup unassigned users" on public.profile_teams;

create policy "Managers can setup unassigned users"
  on public.profile_teams for insert
  with check (
    -- Caller must be Manager or Admin
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and p.role in ('Manager', 'Admin')
    )
    -- Target user must have no existing team assignments
    and not public.user_has_teams(profile_teams.profile_id)
    -- Admin can assign any team; Manager needs Manager role on that team
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'Admin'
      )
      or public.is_manager_on_team(profile_teams.team_id)
    )
  );
