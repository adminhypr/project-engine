-- ─────────────────────────────────────────────
-- 081 · pg_cron jobs send X-Webhook-Secret on edge invocations
--
-- Pairs with the strict secret check in supabase/functions/_shared/security.ts
-- (audit fix #10). verifyWebhookSecret now REJECTS any request when
-- WEBHOOK_SHARED_SECRET is unset or the X-Webhook-Secret header doesn't
-- match. This migration re-schedules each pg_cron job to include that
-- header, sourced from the database setting `app.webhook_secret`.
--
-- The existing schedules (029 / 059 / 063) hardcode the project URL —
-- we keep that convention here. They use jobnames:
--   • dm-offline-notify-minute        (029, every minute)
--   • spawn-recurring-tasks-hourly    (059, every hour)
--   • notification-digest-15min       (063, every 15 minutes)
--
-- send-alerts is scheduled outside pg_cron (Supabase function schedule via
-- CLI/dashboard), so this migration does NOT touch it. Add the header to
-- that schedule manually in the Supabase dashboard.
--
-- TWO MORE callers also depend on the strict check, neither in pg_cron:
--   • notify (Database Webhook on tasks INSERT/UPDATE)
--   • hub-mention-notify (Database Webhook on hub_mentions INSERT)
-- These webhooks are configured in Supabase dashboard → Database →
-- Webhooks. They MUST be edited to include the X-Webhook-Secret header
-- BEFORE the strict-mode functions are deployed, or every webhook fire
-- will silently 401 (no in-app emails on assignment, no hub-mention
-- emails). See deploy steps 2.5 + 6 below.
--
-- ─────────────────────────────────────────────
-- MANUAL DEPLOY STEPS — order matters or cron + webhook callers will 403:
--   1. Generate a random secret value (e.g. `openssl rand -hex 32`).
--   2. In Supabase project: set `WEBHOOK_SHARED_SECRET` function secret
--      (Project settings → Edge Functions → Secrets) to that value.
--   2.5. In Supabase dashboard → Database → Webhooks, edit BOTH the
--        notify webhook AND the hub-mention-notify webhook. Add an
--        HTTP header: `X-Webhook-Secret: <same value>`. Save each.
--        (Skip this and assignment / hub-mention emails go silent.)
--   3. Deploy the four edge functions so the strict check ships with the
--      secret already set:
--        supabase functions deploy notification-digest
--        supabase functions deploy spawn-recurring-tasks
--        supabase functions deploy dm-offline-notify
--        supabase functions deploy send-alerts
--      (notify + hub-mention-notify will also need redeploy if any code
--      changed; otherwise the strict-mode change in _shared/security.ts
--      is picked up on next deploy of any function that imports it.)
--   4. On the database, set the matching session setting (run as superuser):
--        alter database postgres set app.webhook_secret = '<same value>';
--      Note: existing pg_cron job sessions inherit this on their next fire
--      because pg_cron starts a fresh session per run. (Database name is
--      `postgres` on Supabase by default; substitute if your project
--      renames it.)
--   5. Apply this migration.
--   6. (Manual) Add the same X-Webhook-Secret header to the send-alerts
--      schedule via the Supabase dashboard.
--   7. Smoke-test: trigger one task assignment, one hub mention, and
--      wait for one digest tick. Verify email arrives + cron logs show
--      200 not 403.
--
-- If `app.webhook_secret` is NOT set on the database before this migration
-- applies, current_setting('app.webhook_secret', true) returns NULL.
-- jsonb_build_object stores it as JSON null and pg_net serializes the
-- header value as empty/missing — either way the strict check's length
-- comparison fails and returns 403. Cron jobs will 403 every tick until
-- step 4 is completed. No data loss — pending outbox / recurrence rows
-- just sit until the next successful tick.
-- ─────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── notification-digest (every 15 min) — pairs with 063 ──
select cron.unschedule('notification-digest-15min')
  where exists (select 1 from cron.job where jobname = 'notification-digest-15min');

select cron.schedule(
  'notification-digest-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://urdzocyfxgyhqmoqbuvk.functions.supabase.co/notification-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', current_setting('app.webhook_secret', true)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- ── spawn-recurring-tasks (hourly) — pairs with 059 ──
select cron.unschedule('spawn-recurring-tasks-hourly')
  where exists (select 1 from cron.job where jobname = 'spawn-recurring-tasks-hourly');

select cron.schedule(
  'spawn-recurring-tasks-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://urdzocyfxgyhqmoqbuvk.functions.supabase.co/spawn-recurring-tasks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', current_setting('app.webhook_secret', true)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- ── dm-offline-notify (every minute) — pairs with 029 ──
select cron.unschedule('dm-offline-notify-minute')
  where exists (select 1 from cron.job where jobname = 'dm-offline-notify-minute');

select cron.schedule(
  'dm-offline-notify-minute',
  '* * * * *',
  $$
  select net.http_post(
    url      := 'https://urdzocyfxgyhqmoqbuvk.functions.supabase.co/dm-offline-notify',
    headers  := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Webhook-Secret', current_setting('app.webhook_secret', true)
    ),
    body     := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
