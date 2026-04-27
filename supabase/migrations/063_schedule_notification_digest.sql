-- ─────────────────────────────────────────────
-- 063 · Schedule the notification-digest edge function.
-- Every 15 minutes — covers 95% of "I want a summary, not per-event"
-- without burying anyone's inbox or making the bell feel stale.
-- ─────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('notification-digest-15min')
  where exists (select 1 from cron.job where jobname = 'notification-digest-15min');

select cron.schedule(
  'notification-digest-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://urdzocyfxgyhqmoqbuvk.functions.supabase.co/notification-digest',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
