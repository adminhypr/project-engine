-- Schedule the dm-offline-notify edge function to run every minute.
-- Requires pg_cron and pg_net extensions (standard Supabase).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Remove any prior schedule with the same name (idempotent re-apply)
select cron.unschedule('dm-offline-notify-minute')
  where exists (select 1 from cron.job where jobname = 'dm-offline-notify-minute');

select cron.schedule(
  'dm-offline-notify-minute',
  '* * * * *',
  $$
  select net.http_post(
    url      := 'https://urdzocyfxgyhqmoqbuvk.functions.supabase.co/dm-offline-notify',
    headers  := '{"Content-Type": "application/json"}'::jsonb,
    body     := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
