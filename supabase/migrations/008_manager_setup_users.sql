-- ============================================================
-- Migration 008: Allow managers to set up unassigned users
-- Managers can add profile_teams rows for users who have no
-- team assignments, and update profiles.team_id for those users.
-- ============================================================

-- Managers can assign teams to users who have no teams yet
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
    -- Manager can only assign their own teams (admins can assign any)
    and (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.role = 'Admin'
      )
      or exists (
        select 1 from public.profile_teams my_teams
        where my_teams.profile_id = auth.uid()
        and my_teams.team_id = profile_teams.team_id
      )
    )
  );

-- Allow managers to update profiles.team_id for unassigned users (sync primary)
create policy "Managers can update unassigned user profiles"
  on public.profiles for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
      and p.role in ('Manager', 'Admin')
    )
    -- Target user must have no team_id set (unassigned)
    and team_id is null
  );
