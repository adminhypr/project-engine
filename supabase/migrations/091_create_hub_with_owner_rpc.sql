-- ─────────────────────────────────────────────
-- 091 · Atomic hub creation + orphan backfill
--
-- Real prod bug observed today: a user created a hub, briefly saw it,
-- then on refresh it was gone. Production query confirmed 15 orphan
-- hubs (creator missing from hub_members) accumulated over the past
-- 3 weeks; 9 of them completely empty.
--
-- Root cause: `useHubs.createHub` (frontend) issues TWO sequential
-- client-side INSERTs:
--   1. INSERT INTO hubs (created_by = me)
--   2. INSERT INTO hub_members (profile_id = me, role = owner)
-- with NO error check on step 2. If the second request fails for any
-- reason (network blip, browser closed mid-await, RLS rejection), the
-- hub is orphaned. Compounding it, `fetchHubs` uses `hub_members!inner`
-- — a hub with no creator-membership row is excluded from the result
-- entirely, so the creator can't even see it after refresh. The
-- hub_members_insert RLS then prevents them from adding anyone else
-- because they're not yet an owner/admin.
--
-- Fix:
--   1. New SECURITY DEFINER RPC `create_hub_with_owner(...)` that does
--      both INSERTs in one server-side transaction. Atomic — both rows
--      land or neither does.
--   2. Backfill: for every hub where the creator has no hub_members
--      row, insert one with role='owner'. Restores visibility for
--      existing orphans.
--
-- The frontend will switch useHubs.createHub to call this RPC. The
-- existing client-side flow stays as a fallback (and gets defensive
-- error handling) but won't be the default path.
--
-- Externals (Agent/Client) are blocked here too — mirrors the
-- existing isExternal check in useHubs.createHub and the 041 RLS on
-- hubs INSERT.
-- ─────────────────────────────────────────────

create or replace function public.create_hub_with_owner(
  p_name        text,
  p_description text default null,
  p_icon        text default null,
  p_color       text default null
)
returns public.hubs
language plpgsql
security definer
set search_path = public
as $$
declare
  caller    uuid := auth.uid();
  new_hub   public.hubs%rowtype;
  is_ext    boolean;
begin
  if caller is null then
    raise exception 'create_hub_with_owner: not authenticated' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'create_hub_with_owner: name required' using errcode = '22023';
  end if;

  -- Block externals (Agent/Client) — same gate the existing UI applies
  -- and what migration 041 enforces at the hubs INSERT RLS level.
  select public.is_external_user(caller) into is_ext;
  if is_ext then
    raise exception 'create_hub_with_owner: external users cannot create hubs' using errcode = '42501';
  end if;

  insert into public.hubs (name, description, icon, color, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_icon, p_color, caller)
  returning * into new_hub;

  -- Owner row in the same transaction. ON CONFLICT DO NOTHING is
  -- defensive — shouldn't fire because (hub_id, profile_id) is fresh.
  insert into public.hub_members (hub_id, profile_id, role)
  values (new_hub.id, caller, 'owner')
  on conflict do nothing;

  return new_hub;
end;
$$;

revoke all on function public.create_hub_with_owner(text, text, text, text) from public;
grant execute on function public.create_hub_with_owner(text, text, text, text) to authenticated;

-- ── Backfill: heal existing orphan hubs ──────────────────────
-- For every hub where the creator has no hub_members row, insert one
-- as owner. ON CONFLICT DO NOTHING in case of race during apply.
insert into public.hub_members (hub_id, profile_id, role)
select h.id, h.created_by, 'owner'
  from public.hubs h
 where h.created_by is not null
   and not exists (
     select 1 from public.hub_members hm
      where hm.hub_id = h.id and hm.profile_id = h.created_by
   )
on conflict do nothing;
