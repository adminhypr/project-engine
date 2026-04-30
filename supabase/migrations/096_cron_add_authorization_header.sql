-- ─────────────────────────────────────────────
-- 096 · Cron jobs need an Authorization header (gateway constraint)
--
-- Investigated 2026-04-30 after deploying strict-mode edge functions:
-- net._http_response showed 383 × 401 responses with body
--   {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
-- in the past 6 hours. cron.job_run_details said "succeeded" because
-- pg_cron just records that net.http_post fired — it doesn't follow
-- the eventual HTTP response.
--
-- Root cause: Supabase edge function gateway requires an
-- `Authorization` header to be PRESENT on every call, even when the
-- function is deployed with --no-verify-jwt. The gateway doesn't
-- validate the JWT contents in that mode — it just checks for the
-- header. Migrations 081 and 095 omitted the header entirely; cron
-- has been silently 401'ing on every tick (digest, recurring spawn,
-- DM offline notify all failed for hours / since 081 was applied).
--
-- Verified curl test: POST with `Authorization: Bearer arbitrary-string`
-- + valid X-Webhook-Secret returns 200. So we can use any constant
-- string in the bearer; the X-Webhook-Secret is the real auth.
--
-- Update the 3 cron commands to add `Authorization: Bearer cron`. Use
-- a constant rather than the service role key because:
--   1. We don't need to validate; the X-Webhook-Secret already does that.
--   2. Avoids needing to store the service role key in vault.
--   3. The string has zero authorization meaning — it's a header-presence
--      placeholder.
-- ─────────────────────────────────────────────

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
      'Authorization', 'Bearer cron',
      'X-Webhook-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_shared_secret' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

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
      'Authorization', 'Bearer cron',
      'X-Webhook-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_shared_secret' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

select cron.unschedule('dm-offline-notify-minute')
 where exists (select 1 from cron.job where jobname = 'dm-offline-notify-minute');

select cron.schedule(
  'dm-offline-notify-minute',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://urdzocyfxgyhqmoqbuvk.functions.supabase.co/dm-offline-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer cron',
      'X-Webhook-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_shared_secret' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
