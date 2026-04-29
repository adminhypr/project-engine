-- ─────────────────────────────────────────────
-- 075 · Profile_teams write hardening
--
-- Audit found that the Settings page issues client-side UPDATE/DELETE
-- on profile_teams (src/pages/SettingsPage.jsx:438,454,460,474). Today
-- those calls succeed only for Admins (via the 007 "Admins can manage
-- profile teams" FOR ALL policy) and silently fail for Managers — but
-- there is no explicit anti-self-promotion guard anywhere. We add
-- explicit, scoped policies plus a BEFORE UPDATE trigger:
--   • UPDATE: Admin global, OR Manager/TeamLeader on the team being
--     updated. Caller cannot UPDATE their own row's role.
--   • DELETE: Admin global, OR Manager/TeamLeader on the team. Caller
--     cannot DELETE their own row.
--   • INSERT: untouched (007/010/013 already cover it).
--
-- Audit of existing profile_teams policies:
--   • profile_teams_select          (SELECT, from 042)         — KEEP
--   • Admins can manage profile teams (FOR ALL,  from 007)     — KEEP
--       (gives Admin UPDATE/DELETE; the new policy is additive
--        for Manager/TeamLeader, which is what Settings.jsx needs.)
--   • Managers can setup unassigned users (INSERT, from 013)   — KEEP
--
-- The drop-policy lines below are defensive no-ops covering policy
-- names that other audits have used elsewhere; none currently exist
-- on this table but we drop-if-exists so re-runs are idempotent.
-- ─────────────────────────────────────────────

drop policy if exists "profile_teams_update" on public.profile_teams;
drop policy if exists "profile_teams_delete" on public.profile_teams;
drop policy if exists "Profile teams update open" on public.profile_teams;
drop policy if exists "Profile teams delete open" on public.profile_teams;

create policy "profile_teams_update" on public.profile_teams
  for update using (
    -- Admin can update anyone's profile_teams row.
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
    or (
      -- Manager / TeamLeader on this team can update OTHER users' rows on this team.
      profile_id <> auth.uid()
      and exists (
        select 1 from public.profile_teams self_pt
         where self_pt.profile_id = auth.uid()
           and self_pt.team_id = profile_teams.team_id
           and self_pt.role in ('Manager', 'TeamLeader')
      )
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
      profile_id <> auth.uid()
      and exists (
        select 1 from public.profile_teams self_pt
         where self_pt.profile_id = auth.uid()
           and self_pt.team_id = profile_teams.team_id
           and self_pt.role in ('Manager', 'TeamLeader')
      )
    )
  );

-- Belt + suspenders: a BEFORE UPDATE trigger that rejects any role-change
-- on a row where profile_id = auth.uid(), regardless of policy gaps.
create or replace function public.guard_profile_teams_self_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  is_admin boolean;
begin
  if caller is null then return new; end if; -- service role / triggers
  if old.profile_id <> caller then return new; end if;
  if old.role is not distinct from new.role then return new; end if;

  select (role = 'Admin') into is_admin from public.profiles where id = caller;
  if is_admin then return new; end if;

  raise exception 'guard_profile_teams_self_role_change: cannot change own per-team role'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_guard_profile_teams_self_role on public.profile_teams;
create trigger trg_guard_profile_teams_self_role
  before update on public.profile_teams
  for each row execute function public.guard_profile_teams_self_role_change();
