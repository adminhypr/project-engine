-- ─────────────────────────────────────────────
-- 084 · Narrow heartbeat RPC + profile_presence table split
--
-- Today every active tab issues an UPDATE on `profiles` every 60s to bump
-- `last_seen_at`. That UPDATE re-fires both the `sync_effective_role`
-- trigger and the migration-042 self-update guard (every single heartbeat).
-- At ~1000 active users that is ~16 writes/sec on the hottest table in the
-- schema.
--
-- This migration moves the presence cursor onto its own table
-- (`profile_presence`) so heartbeats no longer touch `profiles` at all,
-- bypassing every trigger that hangs off it. A thin SECURITY DEFINER RPC
-- (`heartbeat()`) is the only write path; the frontend calls it via
-- `supabase.rpc('heartbeat')` (and `navigator.sendBeacon` to the PostgREST
-- RPC endpoint on `pagehide` for a best-effort final mark).
--
-- Forward-only safety: `profiles.last_seen_at` is intentionally NOT dropped.
-- Once every reader is migrated and the new path has soaked in production,
-- a follow-up migration can drop the old column. Until then it is stale
-- but harmless. See the comment at the bottom of this file.
-- ─────────────────────────────────────────────

-- ── Table ────────────────────────────────────────────────────
create table if not exists public.profile_presence (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_profile_presence_last_seen_at
  on public.profile_presence(last_seen_at);

-- ── Backfill from the old column ─────────────────────────────
-- Take whatever timestamps `profiles.last_seen_at` currently holds so the
-- digest's "online?" check keeps working through the cutover. Any profile
-- without an existing timestamp gets `now()` via the column default below
-- the first time `heartbeat()` upserts for them.
insert into public.profile_presence (profile_id, last_seen_at)
select id, last_seen_at
from public.profiles
where last_seen_at is not null
on conflict (profile_id) do nothing;

-- ── RLS ──────────────────────────────────────────────────────
-- Match the existing posture for `profiles.last_seen_at`: any authenticated
-- user can read presence (the bell + chat widgets need this). Writes only
-- ever happen via the SECURITY DEFINER `heartbeat()` RPC, so no INSERT /
-- UPDATE policies are exposed to clients.
alter table public.profile_presence enable row level security;

create policy "profile_presence readable by authenticated"
  on public.profile_presence for select
  to authenticated
  using (true);

-- ── RPC ──────────────────────────────────────────────────────
create or replace function public.heartbeat()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.profile_presence (profile_id, last_seen_at)
  values (auth.uid(), now())
  on conflict (profile_id)
    do update set last_seen_at = excluded.last_seen_at;
$$;

revoke all on function public.heartbeat() from public;
grant execute on function public.heartbeat() to authenticated;

comment on function public.heartbeat() is
  'Bumps profile_presence.last_seen_at for the calling user. Replaces the per-tab UPDATE on profiles to avoid re-firing sync_effective_role and the 042 self-update guard 16x/sec at scale.';

comment on table public.profile_presence is
  'Per-profile presence cursor. Written only by public.heartbeat(). Readers (notification-digest, _shared/presence.ts) should prefer this over the legacy profiles.last_seen_at column. profiles.last_seen_at is now stale data only and can be dropped in a follow-up migration after every reader is verified to be reading from profile_presence.';
