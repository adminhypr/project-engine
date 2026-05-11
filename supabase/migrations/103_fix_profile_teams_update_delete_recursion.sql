-- ─────────────────────────────────────────────
-- 103 · Fix infinite-recursion in profile_teams_update / profile_teams_delete
--
-- Real prod bug: clicking the X to remove a team from a user on the Settings
-- page fails with
--   ERROR: 42P17: infinite recursion detected in policy for relation "profile_teams"
-- Reproduced as a global Admin removing a team chip on another user.
--
-- Root cause: migration 075 (profile_teams write hardening) defined the
-- Manager/TeamLeader branches of `profile_teams_update` and `profile_teams_delete`
-- with an inline subquery on profile_teams itself:
--
--     exists (
--       select 1 from public.profile_teams self_pt
--        where self_pt.profile_id = auth.uid()
--          and self_pt.team_id = profile_teams.team_id
--          and self_pt.role in ('Manager','TeamLeader')
--     )
--
-- Postgres applies profile_teams_select RLS to that inner SELECT and detects a
-- policy cycle at plan time — even though the Admin OR branch would short-circuit
-- at runtime, the planner refuses the query before runtime is reached. Same shape
-- as the hub_members bug fixed in migration 093.
--
-- Fix: mirror 093's pattern. Extract the self-referencing subquery into a
-- SECURITY DEFINER STABLE helper. SECURITY DEFINER lets the helper bypass RLS,
-- so the planner does not see a cycle.
--
-- Behavior preserved exactly:
--   • Admin global → can UPDATE/DELETE any profile_teams row (both via the
--     unchanged 007 "Admins can manage profile teams" FOR ALL policy AND via
--     the first branch of this policy — both still hold).
--   • Manager / TeamLeader on a team → can UPDATE/DELETE OTHER users' rows on
--     that team. Cannot target their own row, cannot demote an Admin.
--   • Self-modify protection unchanged:
--       - profile_teams_update WITH CHECK still blocks self-promotion via UPDATE.
--       - guard_profile_teams_self_role_change BEFORE UPDATE trigger still
--         blocks self-role-change as belt-and-suspenders.
--   • INSERT policy untouched (007/010/013).
--   • SELECT policy untouched (042).
-- ─────────────────────────────────────────────

-- SECURITY DEFINER STABLE helper — bypasses RLS so the planner can hoist it
-- without detecting a self-cycle on profile_teams.
create or replace function public.is_team_manager_or_leader(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profile_teams
     where profile_id = auth.uid()
       and team_id = p_team_id
       and role in ('Manager', 'TeamLeader')
  );
$$;

revoke all on function public.is_team_manager_or_leader(uuid) from public;
grant execute on function public.is_team_manager_or_leader(uuid) to authenticated;

-- Recreate update/delete policies using the helper.
drop policy if exists "profile_teams_update" on public.profile_teams;
drop policy if exists "profile_teams_delete" on public.profile_teams;

create policy "profile_teams_update" on public.profile_teams
  for update using (
    -- Admin can update any profile_teams row.
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
    or (
      -- Manager / TeamLeader on this team can update OTHER users' rows on this team.
      -- Cannot target their own row, and cannot target an Admin (no demoting Admins).
      profile_id <> auth.uid()
      and not exists (
        select 1 from public.profiles tp
         where tp.id = profile_teams.profile_id and tp.role = 'Admin'
      )
      and public.is_team_manager_or_leader(profile_teams.team_id)
    )
  )
  with check (
    -- Cannot promote yourself via the WITH CHECK side either.
    profile_id <> auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  );

create policy "profile_teams_delete" on public.profile_teams
  for delete using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
    or (
      -- Same constraints as UPDATE: cannot self-delete, cannot kick an Admin.
      profile_id <> auth.uid()
      and not exists (
        select 1 from public.profiles tp
         where tp.id = profile_teams.profile_id and tp.role = 'Admin'
      )
      and public.is_team_manager_or_leader(profile_teams.team_id)
    )
  );
