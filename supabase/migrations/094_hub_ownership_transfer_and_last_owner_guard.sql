-- ─────────────────────────────────────────────
-- 094 · Hub ownership transfer RPC + last-owner guard
--
-- Two new capabilities:
--
-- 1. transfer_hub_ownership(p_hub_id, p_new_owner_id)
--    Atomic owner swap. Caller must be the current owner of the hub
--    OR a global Admin. The new owner must already be a member of
--    the hub. Promotes new owner to 'owner' first (always safe — adds
--    an owner), then demotes the caller to 'admin' if the caller is
--    a hub owner. Global Admin callers (who may not be hub members)
--    just promote without demoting themselves.
--
-- 2. prevent_last_owner_loss() trigger
--    BEFORE DELETE OR UPDATE on hub_members. Blocks any operation
--    that would leave the hub with zero owners:
--      • DELETE of the last owner row (e.g., owner trying to "leave")
--      • UPDATE that demotes the last owner (role = 'owner' → other)
--    Cascade-aware: if the parent hub is being deleted (cascade
--    chain), the guard skips so the hub delete itself isn't blocked.
--    Same pattern as the card-assignee fix in migration 092.
--
-- Together these make "Leave hub" safe for any non-last-owner, and
-- give owners a clean path to hand off the hub before leaving.
-- ─────────────────────────────────────────────

-- ── 1. Last-owner guard trigger ──────────────────────────────
create or replace function public.prevent_last_owner_loss()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_owners int;
begin
  -- Cascade-delete guard: if the parent hub is being deleted, skip
  -- the check so the hub-level delete cascade isn't blocked. Mirrors
  -- migration 092's pattern.
  if not exists (select 1 from public.hubs where id = old.hub_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' and old.role = 'owner' then
    select count(*) into remaining_owners
      from public.hub_members
     where hub_id = old.hub_id
       and role = 'owner'
       and profile_id <> old.profile_id;
    if remaining_owners < 1 then
      raise exception 'Cannot remove the last owner of a hub. Transfer ownership first or delete the hub.'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE'
     and old.role = 'owner'
     and new.role is distinct from 'owner' then
    select count(*) into remaining_owners
      from public.hub_members
     where hub_id = old.hub_id
       and role = 'owner'
       and profile_id <> old.profile_id;
    if remaining_owners < 1 then
      raise exception 'Cannot demote the last owner of a hub. Promote another member to owner first.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_prevent_last_owner_loss on public.hub_members;
create trigger trg_prevent_last_owner_loss
  before update or delete on public.hub_members
  for each row execute function public.prevent_last_owner_loss();

-- ── 2. transfer_hub_ownership RPC ────────────────────────────
create or replace function public.transfer_hub_ownership(
  p_hub_id        uuid,
  p_new_owner_id  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller          uuid := auth.uid();
  caller_role     text;
  is_admin_global boolean;
begin
  if caller is null then
    raise exception 'transfer_hub_ownership: not authenticated' using errcode = '42501';
  end if;
  if p_hub_id is null or p_new_owner_id is null then
    raise exception 'transfer_hub_ownership: hub_id and new_owner_id required' using errcode = '22023';
  end if;
  if caller = p_new_owner_id then
    raise exception 'transfer_hub_ownership: cannot transfer to yourself' using errcode = '22023';
  end if;

  -- Caller must be the hub's current owner OR global Admin.
  caller_role     := public.hub_member_role(p_hub_id);
  select (role = 'Admin') into is_admin_global from public.profiles where id = caller;

  if (caller_role is distinct from 'owner') and not coalesce(is_admin_global, false) then
    raise exception 'transfer_hub_ownership: only the hub owner or a global Admin can transfer'
      using errcode = '42501';
  end if;

  -- New owner must already be a member.
  if not exists (
    select 1 from public.hub_members
     where hub_id = p_hub_id and profile_id = p_new_owner_id
  ) then
    raise exception 'transfer_hub_ownership: new owner must already be a hub member'
      using errcode = '23503';
  end if;

  -- Promote new owner FIRST. This is always safe — adds an owner, can
  -- never trip the last-owner guard. After this update there are at
  -- least 2 owners (the original + the new one).
  update public.hub_members
     set role = 'owner'
   where hub_id = p_hub_id and profile_id = p_new_owner_id;

  -- Demote previous owner to admin. Skip if the caller is acting as
  -- a global Admin (not a hub member themselves).
  if caller_role = 'owner' then
    update public.hub_members
       set role = 'admin'
     where hub_id = p_hub_id and profile_id = caller;
  end if;
end;
$$;

revoke all on function public.transfer_hub_ownership(uuid, uuid) from public;
grant execute on function public.transfer_hub_ownership(uuid, uuid) to authenticated;
