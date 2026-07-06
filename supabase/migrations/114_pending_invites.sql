-- 114_pending_invites.sql
-- Invite intent (role + team) currently lives in the INVITING admin's browser
-- localStorage (src/lib/pendingInvites.js). If a different admin grants the
-- user their first team, the invited role/team silently vanish. This table
-- makes invite intent server-side so any Admin/Manager's first team-grant can
-- apply it. Known limitation logged in
-- docs/plans/2026-07-05-settings-redesign-design.md.
--
-- Frontend flow:
--   Settings "Invite User" upserts a row here (email lowercased).
--   useUserAdmin.addTeamToUser reads the row on a user's FIRST team grant,
--   applies the invited role, then deletes the row (legacy localStorage is
--   kept as a read-only fallback for invites sent before this deploy).
--
-- Pitfall pre-flight (memory: migration_pitfalls):
--   #1  policies reference profiles (a DIFFERENT table) -> no recursion.
--   #2  single FK to teams and single FK to profiles -> no embed ambiguity.
--   #9/#11 SELECT policy covers the same principals as INSERT -> the
--       inserter can always read back (INSERT ... RETURNING safe).
--   #10 no sibling table to mirror; this is a brand-new lane.
--   Idempotent: safe to re-run.

create table if not exists public.pending_invites (
  email        text primary key,
  role         text not null default 'Staff'
               check (role in ('Staff', 'Manager', 'Agent', 'Client')),
  team_id      uuid references public.teams(id) on delete set null,
  invited_by   uuid references public.profiles(id) on delete set null,
  inviter_name text,
  created_at   timestamptz not null default now(),
  constraint pending_invites_email_lower check (email = lower(email))
);

alter table public.pending_invites enable row level security;

-- Internal Admins and Managers manage invites (mirrors who sees the
-- Invite User card in Settings). Externals and Staff have no access.
drop policy if exists pending_invites_select on public.pending_invites;
create policy pending_invites_select
  on public.pending_invites for select
  using (exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.role in ('Admin', 'Manager')
  ));

drop policy if exists pending_invites_insert on public.pending_invites;
create policy pending_invites_insert
  on public.pending_invites for insert
  with check (exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.role in ('Admin', 'Manager')
  ));

drop policy if exists pending_invites_update on public.pending_invites;
create policy pending_invites_update
  on public.pending_invites for update
  using (exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.role in ('Admin', 'Manager')
  ))
  with check (exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.role in ('Admin', 'Manager')
  ));

drop policy if exists pending_invites_delete on public.pending_invites;
create policy pending_invites_delete
  on public.pending_invites for delete
  using (exists (
    select 1 from public.profiles pr
    where pr.id = auth.uid() and pr.role in ('Admin', 'Manager')
  ));
