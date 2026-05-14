-- ─────────────────────────────────────────────
-- 104 · Sentry → Campfire error notifications
--
-- Backs the `sentry-to-campfire` edge function. Three pieces:
--   1. A "Sentry" bot profile that authors error messages in the
--      Errors campfire. Bot uses a fixed UUID so the edge function
--      can reference it without a lookup. auth.users insert is
--      required because profiles.id → auth.users(id) (mig 001);
--      handle_new_user trigger from 001 creates the profile row
--      automatically, then we sync the columns we care about.
--   2. `sentry_alert_dedupe` table — keyed by Sentry issue fingerprint.
--      Lets the edge function collapse same-fingerprint events within a
--      15-minute window into one updated message ("Seen N×") instead of
--      spamming the channel.
--   3. Nightly retention prune (mig 082 pattern) — 30 day window.
--
-- Bot can't actually authenticate (no real password, no app metadata
-- providers). It's a service identity for attribution + RLS purposes
-- only. dm_messages.kind = 'system' is used by the edge function so
-- bot posts are distinguishable from user posts at the data layer.
--
-- After this migration applies, finish setup manually (see
-- docs/plans/2026-05-14-sentry-campfire-design.md, Phase 5):
--   • Create "Errors" campfire module in the Systems Development hub.
--   • Add bot to hub_members of that hub.
--   • Upload a robot avatar to profiles.avatar_url for the bot.
--   • Capture the new conversation id → SENTRY_CAMPFIRE_CONVERSATION_ID
--     edge function env var.
-- ─────────────────────────────────────────────

create extension if not exists pg_cron;

-- ── 1. Sentry bot identity ────────────────────────────────────
-- Fixed UUID: ...5e74 = "SE NT RY" loosely. Easy to recognize in logs.

do $$
declare
  bot_id constant uuid := '00000000-0000-0000-0000-000000005e74';
begin
  -- auth.users row. handle_new_user trigger (mig 001) creates the
  -- matching public.profiles row automatically.
  if not exists (select 1 from auth.users where id = bot_id) then
    insert into auth.users (
      instance_id, id, aud, role,
      email, encrypted_password,
      email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token,
      is_sso_user
    ) values (
      '00000000-0000-0000-0000-000000000000',
      bot_id,
      'authenticated', 'authenticated',
      'sentry-bot@hyprassistants.com',
      -- bcrypt hash of a random string. Bot has no real password —
      -- this just satisfies the NOT NULL constraint and prevents login.
      '$2a$10$' || encode(gen_random_bytes(40), 'hex'),
      now(),
      '{"provider":"system","providers":["system"]}'::jsonb,
      '{"full_name":"Sentry"}'::jsonb,
      now(), now(),
      '', '', '', '',
      false
    );
  end if;

  -- Sync columns the trigger doesn't set (or sets from raw metadata
  -- differently than we want). Idempotent.
  update public.profiles
     set full_name = 'Sentry',
         role     = 'Staff'
   where id = bot_id;
end $$;

-- ── 2. Dedupe table ───────────────────────────────────────────

create table if not exists public.sentry_alert_dedupe (
  issue_id          text primary key,
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  last_message_id   uuid not null references public.dm_messages(id) on delete cascade,
  environment       text not null,
  level             text not null,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  event_count       integer not null default 1
);

create index if not exists sentry_alert_dedupe_last_seen_idx
  on public.sentry_alert_dedupe (last_seen_at);

alter table public.sentry_alert_dedupe enable row level security;
-- No policies — service role only. Frontend has no reason to read this.
revoke all on public.sentry_alert_dedupe from public;

-- ── 3. Retention prune (mig 082 pattern) ──────────────────────

create or replace function public.prune_sentry_alert_dedupe()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  pruned int;
begin
  with deleted as (
    delete from public.sentry_alert_dedupe
     where last_seen_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::int into pruned from deleted;
  return coalesce(pruned, 0);
end;
$$;

revoke all on function public.prune_sentry_alert_dedupe() from public;

select cron.unschedule('prune-sentry-alert-dedupe')
  where exists (select 1 from cron.job where jobname = 'prune-sentry-alert-dedupe');

select cron.schedule(
  'prune-sentry-alert-dedupe',
  '50 3 * * *',
  $$select public.prune_sentry_alert_dedupe();$$
);
