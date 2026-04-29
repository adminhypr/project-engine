-- ─────────────────────────────────────────────
-- 074 · Restrict hub_members self-insert to fresh-hub creators
--
-- The 016 self-insert escape (profile_id = auth.uid() AND role='owner')
-- lets any authenticated user claim ownership of any hub. Replace with
-- a tighter rule: self-insert as owner is only valid when the hub has
-- ZERO existing members (i.e. it was just created by the caller).
-- ─────────────────────────────────────────────

drop policy if exists "hub_members_insert" on public.hub_members;

create policy "hub_members_insert" on public.hub_members for insert with check (
  -- Hub owner/admin adding someone:
  exists (
    select 1 from public.hub_members hm
     where hm.hub_id = hub_members.hub_id
       and hm.profile_id = auth.uid()
       and hm.role in ('owner', 'admin')
  )
  -- Global Admin:
  or exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.role = 'Admin'
  )
  -- Self-insert as owner ONLY when the hub has no members yet (creator path).
  -- Once any row exists, self-insert is no longer possible via this clause.
  or (
    hub_members.profile_id = auth.uid()
    and hub_members.role = 'owner'
    and not exists (select 1 from public.hub_members hm2 where hm2.hub_id = hub_members.hub_id)
  )
);
