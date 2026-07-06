-- 115_fix_sync_effective_role_reserved_keyword.sql
-- CRITICAL latent bug, present since 038: the trigger function declared a
-- plpgsql variable named "current_role". In plpgsql expressions the SQL
-- reserved keyword CURRENT_ROLE (session role, e.g. 'postgres' /
-- 'authenticated') shadows the variable, so:
--   if current_role in ('Admin', 'Agent', 'Client') then ... skip ...
-- was ALWAYS FALSE. Consequences:
--   1. Sticky roles (Admin/Agent/Client) were NEVER protected by the
--      trigger. Externals stayed sticky only because the legacy UI happened
--      to write profiles.role AFTER profile_teams (write-order accident).
--   2. Latent Admin demotion: any profile_teams INSERT/UPDATE/DELETE for an
--      Admin recomputed and overwrote their global role to Manager/Staff.
-- Empirically confirmed 2026-07-05:
--   do $$ declare current_role text; begin select 'Agent' into current_role;
--   if current_role in ('Agent') then raise exception 'VAR WINS'; else
--   raise exception 'KEYWORD WINS: %', current_role; end if; end $$;
--   -> "KEYWORD WINS: postgres"
-- Fix: rename the variable (v_current_role). Behavior is otherwise the
-- exact 038 logic. Idempotent (create or replace).

create or replace function public.sync_effective_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  v_current_role text;
  v_max_team_role text;
begin
  target_id := coalesce(new.profile_id, old.profile_id);

  select role into v_current_role
  from public.profiles where id = target_id;

  -- Sticky roles: never overwrite Admin/Agent/Client via per-team sync.
  if v_current_role in ('Admin', 'Agent', 'Client') then
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
  ) into v_max_team_role
  from public.profile_teams pt
  where pt.profile_id = target_id
    and pt.role in ('Manager', 'Staff', 'TeamLeader');

  if v_max_team_role is distinct from v_current_role then
    update public.profiles set role = v_max_team_role where id = target_id;
  end if;

  return coalesce(new, old);
end;
$$;
