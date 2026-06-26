-- ---------------------------------------------
-- 112 - API keys (Dev API + hypr CLI)
--
-- Per-developer personal access tokens that let the `dev-api` edge function
-- authenticate a CLI request and act on behalf of that developer, scoped to the
-- Dev Projects they're a member of.
--
-- Security: the plaintext key (`hypr_<32 hex>`) is generated CLIENT-SIDE, shown
-- to the user exactly once, and only its sha256 hash + a display prefix are
-- stored. The server never sees the plaintext. The edge function hashes the
-- incoming Bearer token and looks it up by `key_hash` via the service role.
-- ---------------------------------------------

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  name         text not null,
  key_prefix   text not null,             -- e.g. "hypr_a1b2c3" — shown in the UI list
  key_hash     text not null unique,      -- sha256 hex of the full key
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

create index if not exists api_keys_profile_idx on public.api_keys(profile_id);
create index if not exists api_keys_hash_idx on public.api_keys(key_hash);

alter table public.api_keys enable row level security;

-- A user manages ONLY their own keys. The dev-api edge function reads by
-- key_hash via the service role (which bypasses RLS).
drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys
  for select using (profile_id = auth.uid());

drop policy if exists api_keys_insert on public.api_keys;
create policy api_keys_insert on public.api_keys
  for insert with check (profile_id = auth.uid());

-- Revoke (set revoked_at) / rename on own keys.
drop policy if exists api_keys_update on public.api_keys;
create policy api_keys_update on public.api_keys
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists api_keys_delete on public.api_keys;
create policy api_keys_delete on public.api_keys
  for delete using (profile_id = auth.uid());
