-- ─────────────────────────────────────────────
-- 043 · Fix get_or_create_team_group for service/trigger context
--
-- Migration 042 added a caller-is-member check to
-- get_or_create_team_group(tid). That check raises when auth.uid() is
-- null — which is exactly the case inside the sync_team_group_membership
-- trigger (migration 033) when rows are inserted via:
--   - service_role / Auth Admin API (onboarding users)
--   - Supabase seed + migration backfill
--   - any SECURITY DEFINER function that propagates to profile_teams
--
-- Net effect: every new profile_teams INSERT was failing, breaking
-- Manager-adds-staff, Admin onboarding, and pending-invite grants.
--
-- Fix: only enforce the member check for real authenticated callers.
-- Service/trigger contexts (auth.uid() is null) are already privileged
-- and bypass. Agents/users still get the I3 protection.
-- ─────────────────────────────────────────────

create or replace function public.get_or_create_team_group(tid uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  existing uuid;
  new_id   uuid;
  tname    text;
  me       uuid := auth.uid();
begin
  if tid is null then raise exception 'team id required'; end if;

  -- Only enforce the caller-is-member rule for real authenticated callers.
  -- Service-role / trigger / backfill paths (auth.uid() is null) are
  -- already privileged and skip the check. The I3 attack surface
  -- (an Agent poking foreign team ids) is still closed because an
  -- authenticated-but-not-member caller has a non-null auth.uid().
  if me is not null
     and not exists (select 1 from public.profile_teams
                     where profile_id = me and team_id = tid)
     and not exists (select 1 from public.profiles
                     where id = me and role = 'Admin')
  then
    raise exception 'not a member of this team';
  end if;

  select id into existing
  from public.conversations
  where kind = 'group' and team_id = tid
  limit 1;
  if existing is not null then return existing; end if;

  select name into tname from public.teams where id = tid;
  insert into public.conversations (kind, team_id, title, created_by)
    values ('group', tid, coalesce(tname, 'Team'), null)
    returning id into new_id;
  return new_id;
end;
$$;
grant execute on function public.get_or_create_team_group(uuid) to authenticated;
