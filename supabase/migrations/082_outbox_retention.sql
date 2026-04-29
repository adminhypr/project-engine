-- ─────────────────────────────────────────────
-- 082 · Outbox + audit log retention
--
-- Three pure-SQL prune helpers run nightly via pg_cron:
--   • prune_notification_outbox()  — emailed rows older than 30 days
--   • prune_task_audit_log()       — rows older than 1 year
--   • prune_hub_card_audit_log()   — rows older than 180 days
--
-- All three use the CTE pattern (with deleted as (... returning 1)
-- select count(*)::int from deleted) so they actually report the row
-- count instead of returning the literal 1 from the first deleted row
-- (the bug the Task 2.1 review caught and fixed in 078).
--
-- Unlike the cron jobs added in 081, these prune jobs do NOT call edge
-- functions via net.http_post — they call SQL functions directly via
-- `select prune_*()`. So they need no webhook secret, no project URL,
-- and no headers. Pure DB-side maintenance.
--
-- Re-runnability: each cron.schedule is preceded by an idempotent
-- cron.unschedule(...) where exists (...) guard, mirroring the 081
-- pattern. Safe to apply more than once.
-- ─────────────────────────────────────────────

create extension if not exists pg_cron;

-- ── prune_notification_outbox ─────────────────────────────
-- Retain emailed rows for 30 days. Online + opted-out skip rows now
-- also have emailed_at set (Task 2.2), so this prunes them too.

create or replace function public.prune_notification_outbox()
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
    delete from public.notification_outbox
     where emailed_at is not null
       and emailed_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::int into pruned from deleted;
  return coalesce(pruned, 0);
end;
$$;

revoke all on function public.prune_notification_outbox() from public;

-- ── prune_task_audit_log ──────────────────────────────────
-- Retain task audit entries for 1 year.

create or replace function public.prune_task_audit_log()
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
    delete from public.task_audit_log
     where created_at < now() - interval '1 year'
    returning 1
  )
  select count(*)::int into pruned from deleted;
  return coalesce(pruned, 0);
end;
$$;

revoke all on function public.prune_task_audit_log() from public;

-- ── prune_hub_card_audit_log ──────────────────────────────
-- Retain hub card audit entries for 180 days.

create or replace function public.prune_hub_card_audit_log()
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
    delete from public.hub_card_audit_log
     where created_at < now() - interval '180 days'
    returning 1
  )
  select count(*)::int into pruned from deleted;
  return coalesce(pruned, 0);
end;
$$;

revoke all on function public.prune_hub_card_audit_log() from public;

-- ── pg_cron schedules (nightly UTC) ───────────────────────

select cron.unschedule('prune-notification-outbox')
  where exists (select 1 from cron.job where jobname = 'prune-notification-outbox');

select cron.schedule(
  'prune-notification-outbox',
  '15 3 * * *',
  $$select public.prune_notification_outbox();$$
);

select cron.unschedule('prune-task-audit-log')
  where exists (select 1 from cron.job where jobname = 'prune-task-audit-log');

select cron.schedule(
  'prune-task-audit-log',
  '30 3 * * *',
  $$select public.prune_task_audit_log();$$
);

select cron.unschedule('prune-hub-card-audit-log')
  where exists (select 1 from cron.job where jobname = 'prune-hub-card-audit-log');

select cron.schedule(
  'prune-hub-card-audit-log',
  '45 3 * * *',
  $$select public.prune_hub_card_audit_log();$$
);
