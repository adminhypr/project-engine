-- ─────────────────────────────────────────────
-- 059 · pg_cron schedule for the spawn-recurring-tasks edge function.
-- Hourly (top of the hour).
-- ─────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('spawn-recurring-tasks-hourly')
  where exists (select 1 from cron.job where jobname = 'spawn-recurring-tasks-hourly');

select cron.schedule(
  'spawn-recurring-tasks-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://urdzocyfxgyhqmoqbuvk.functions.supabase.co/spawn-recurring-tasks',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
