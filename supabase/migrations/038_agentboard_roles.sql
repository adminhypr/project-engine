-- ─────────────────────────────────────────────
-- 038 · Agentboard roles
--
-- Adds two new global account types (Agent, Client) and one new per-team
-- role (TeamLeader). Externals are sticky: the role-sync trigger never
-- overwrites an Agent/Client global role based on their per-team rows.
-- ─────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- 1. Extend the profiles.role check constraint.
--    001_initial.sql declared the CHECK inline (unnamed), so Postgres
--    auto-named it `profiles_role_check`. Drop + recreate.
-- ─────────────────────────────────────────────
alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('Admin', 'Manager', 'Staff', 'Agent', 'Client'));

-- ─────────────────────────────────────────────
-- 2. Extend the profile_teams.role check constraint to allow TeamLeader.
--    Also allow Agent/Client as purely descriptive per-team values.
--    010_per_team_role.sql declared the CHECK inline (unnamed), so
--    Postgres auto-named it `profile_teams_role_check`.
-- ─────────────────────────────────────────────
alter table public.profile_teams
  drop constraint if exists profile_teams_role_check;
alter table public.profile_teams
  add constraint profile_teams_role_check
  check (role in ('Manager', 'Staff', 'TeamLeader', 'Agent', 'Client'));

-- ─────────────────────────────────────────────
-- 3. Replace the role-sync trigger function from migration 010.
--    The existing function is named `sync_effective_role()` and is
--    bound to trigger `trg_sync_effective_role` on `profile_teams`.
--    CREATE OR REPLACE keeps the existing trigger binding intact.
--
--    Behavior:
--      - Never overwrite an Admin/Agent/Client global role (sticky).
--      - Otherwise, set profiles.role to the max per-team authority:
--        Manager > Staff. TeamLeader is a per-team-only designation and
--        does not promote profiles.role (treated as Staff at the global
--        level).
-- ─────────────────────────────────────────────
create or replace function public.sync_effective_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  current_role text;
  max_team_role text;
begin
  target_id := coalesce(new.profile_id, old.profile_id);

  select role into current_role
  from public.profiles where id = target_id;

  -- Sticky roles: never overwrite Admin/Agent/Client via per-team sync.
  if current_role in ('Admin', 'Agent', 'Client') then
    return coalesce(new, old);
  end if;

  -- Compute max authority across internal per-team roles only.
  -- TeamLeader is per-team only; it collapses to 'Staff' globally.
  select coalesce(
    case
      when bool_or(pt.role = 'Manager') then 'Manager'
      else 'Staff'
    end,
    'Staff'
  ) into max_team_role
  from public.profile_teams pt
  where pt.profile_id = target_id
    and pt.role in ('Manager', 'Staff', 'TeamLeader');

  if max_team_role is distinct from current_role then
    update public.profiles set role = max_team_role where id = target_id;
  end if;

  return coalesce(new, old);
end;
$$;

-- ─────────────────────────────────────────────
-- 4. Helper: is this user an external (Agent or Client)?
-- ─────────────────────────────────────────────
create or replace function public.is_external_user(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = uid and role in ('Agent', 'Client')
  );
$$;

grant execute on function public.is_external_user(uuid) to authenticated;
