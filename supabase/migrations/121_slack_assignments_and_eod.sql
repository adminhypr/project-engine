-- ============================================================
-- 121: Slack — assignment notifications + 6pm ET daily wrap-up
--
-- Builds on 120. Two additions:
--   1. Trigger on task_assignees INSERT → "X put Y on 'task'" post.
--      Skips rows written as part of task creation (the creation
--      announcement already names the assignees) using a 60-second
--      created_at heuristic on the parent task.
--   2. pg_cron job `slack-eod-digest` fires the edge function's
--      eod_digest event once a day. Scheduled at 22:00 UTC = 6:00pm
--      Eastern DAYLIGHT time. pg_cron runs in UTC and does not follow
--      DST — when the US falls back in November this becomes 5pm ET;
--      re-schedule to '0 23 * * *' then if the team cares.
--
-- Auth follows the 096 pattern (Bearer placeholder + Vault secret).
-- ============================================================

-- ── 1. Task assigned to a person ─────────────────────────────
create or replace function public.slack_project_assigned()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_task record;
begin
  select project_id, created_at into v_task from public.tasks where id = new.task_id;
  if v_task.project_id is null then return new; end if;
  -- Creation-time assignee rows ride the feature_created announcement.
  if v_task.created_at > now() - interval '60 seconds' then return new; end if;

  perform public._slack_post('assigned', jsonb_build_object(
    'record', to_jsonb(new),
    'actor',  auth.uid()
  ));
  return new;
end;
$$;

drop trigger if exists trg_slack_project_assigned on public.task_assignees;
create trigger trg_slack_project_assigned
  after insert on public.task_assignees
  for each row execute function public.slack_project_assigned();

-- ── 2. Daily wrap-up at 6pm Eastern ──────────────────────────
select cron.unschedule('slack-eod-digest')
 where exists (select 1 from cron.job where jobname = 'slack-eod-digest');

select cron.schedule(
  'slack-eod-digest',
  '0 22 * * *',  -- 22:00 UTC = 6pm EDT (see header re: DST)
  $$
  select net.http_post(
    url     := 'https://urdzocyfxgyhqmoqbuvk.functions.supabase.co/slack-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer cron',
      'X-Webhook-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'webhook_shared_secret' limit 1)
    ),
    body    := '{"event":"eod_digest","record":{}}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
