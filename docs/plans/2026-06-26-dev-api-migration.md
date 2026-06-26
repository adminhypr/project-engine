# Dev API — Migration 112 + edge function deploy

Two manual steps to make the `hypr` CLI work end to end. The Settings → API Keys UI ships with the frontend and works after step 1.

## Step 1 — apply migration 112 (`api_keys` table)

Paste the **raw SQL** below into the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql/new) and **Run**. (Or run `supabase/migrations/112_api_keys.sql` — same content; don't paste the ``` fences.)

```sql
create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  name         text not null,
  key_prefix   text not null,
  key_hash     text not null unique,
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

create index if not exists api_keys_profile_idx on public.api_keys(profile_id);
create index if not exists api_keys_hash_idx on public.api_keys(key_hash);

alter table public.api_keys enable row level security;

drop policy if exists api_keys_select on public.api_keys;
create policy api_keys_select on public.api_keys
  for select using (profile_id = auth.uid());

drop policy if exists api_keys_insert on public.api_keys;
create policy api_keys_insert on public.api_keys
  for insert with check (profile_id = auth.uid());

drop policy if exists api_keys_update on public.api_keys;
create policy api_keys_update on public.api_keys
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists api_keys_delete on public.api_keys;
create policy api_keys_delete on public.api_keys
  for delete using (profile_id = auth.uid());
```

## Step 2 — deploy the `dev-api` edge function

```bash
supabase functions deploy dev-api --no-verify-jwt
```

- `--no-verify-jwt` is required: the CLI authenticates with its own `hypr_…` token (in `x-hypr-key`), not a Supabase JWT.
- Env: the function uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, both injected automatically by Supabase. Nothing to set.
- No webhook secret / no pg_cron — auth is the per-dev API key.

## Verify

```bash
# generate a key in Settings → API Keys, then:
cd cli && npm install -g .
hypr login            # paste the key
hypr projects         # should list the projects you're a member of
hypr tasks PMAPMS
```
