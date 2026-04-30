-- ─────────────────────────────────────────────
-- 093 · Fix infinite-recursion in hub_members_insert RLS
--
-- Real prod bug: clicking "Add member" in a hub failed with
--   ERROR: 42P17: infinite recursion detected in policy for relation "hub_members"
-- Reproduced by impersonating the hub owner (a global Admin too) and
-- INSERTing into hub_members directly.
--
-- Root cause: migration 074 (mine, 2 days ago) replaced the recursion-
-- safe `hub_members_insert` policy that migration 017 carefully built.
-- The 074 version uses `EXISTS (SELECT 1 FROM hub_members hm WHERE …)`
-- inline. Postgres applies hub_members_select RLS to that inner SELECT
-- and detects a policy cycle — even though hub_members_select uses the
-- SECURITY DEFINER `is_hub_member()` helper that bypasses RLS at
-- runtime, the planner flags it at plan time and refuses the query.
-- Short-circuiting on the Admin-global OR clause never gets a chance
-- to run.
--
-- Fix: rewrite the INSERT policy to use the existing SECURITY DEFINER
-- helpers (`hub_member_role`) plus a new `hub_has_members(uuid)` helper
-- for the creator-self-insert clause. Same SECURITY DEFINER + STABLE
-- pattern as is_hub_member / hub_member_role from migration 017.
--
-- Behavior preserved:
--   • Owner/admin of this hub can add members.
--   • Global Admin can add members.
--   • Self-insert as owner only when the hub has zero members yet
--     (the creator path — also redundant with the create_hub_with_owner
--     RPC from 091, but kept as a safety net for any caller still on
--     the old client flow).
-- ─────────────────────────────────────────────

-- New helper (mirrors is_hub_member from 017's pattern). SECURITY
-- DEFINER + STABLE so it bypasses RLS and the planner can hoist it
-- without cycle detection.
create or replace function public.hub_has_members(p_hub_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.hub_members where hub_id = p_hub_id);
$$;

revoke all on function public.hub_has_members(uuid) from public;
grant execute on function public.hub_has_members(uuid) to authenticated;

-- Recreate the policy using helpers.
drop policy if exists "hub_members_insert" on public.hub_members;

create policy "hub_members_insert" on public.hub_members for insert with check (
  -- Hub owner/admin adding someone (helper bypasses RLS, no recursion).
  public.hub_member_role(hub_members.hub_id) = any (array['owner', 'admin'])
  -- Global Admin.
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  -- Self-insert as owner only when the hub has no members yet (creator
  -- path; also covered by the create_hub_with_owner RPC from 091).
  or (
    hub_members.profile_id = auth.uid()
    and hub_members.role = 'owner'
    and not public.hub_has_members(hub_members.hub_id)
  )
);
