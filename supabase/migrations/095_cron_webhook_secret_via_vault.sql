-- ─────────────────────────────────────────────
-- 095 · Cron webhook secret via Supabase Vault (GUC fallback)
--
-- Migration 081 wrote the cron jobs to read the secret from
--   current_setting('app.webhook_secret', true)
-- which was supposed to be set via
--   alter database postgres set app.webhook_secret = '...';
--
-- That ALTER fails on Supabase managed Postgres with
--   42501: permission denied to set parameter "app.webhook_secret"
-- The dashboard SQL editor runs as the `postgres` role but with
-- restricted privileges — `app.*` GUCs aren't in the allow-list.
--
-- Switch to Supabase Vault (the project's encrypted secret store).
-- The secret value lives in `vault.secrets` (encrypted at rest with
-- pgsodium) and is read via the `vault.decrypted_secrets` view. The
-- secret must already exist with name='webhook_shared_secret':
--   select vault.create_secret('<value>', 'webhook_shared_secret');
-- (Run that ONCE in the SQL editor before applying this migration.)
--
-- Re-schedules the same 3 cron jobs from migration 081 with the only
-- change being how the X-Webhook-Secret header value is sourced.
-- ─────────────────────────────────────────────

-- Defensive: ensure the secret exists. If not, raise so we don't ship
-- broken cron jobs.
do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'webhook_shared_secret'
  ) then
    raise exception '095: vault secret "webhook_shared_secret" not found. Run select vault.create_secret(''<value>'', ''webhook_shared_secret''); first.';
  end if;
end $$;

-- ── notification-digest-15min ──
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
      'X-Webhook-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_shared_secret' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- ── spawn-recurring-tasks-hourly ──
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
      'X-Webhook-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_shared_secret' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- ── dm-offline-notify-minute ──
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
      'X-Webhook-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_shared_secret' limit 1)
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
