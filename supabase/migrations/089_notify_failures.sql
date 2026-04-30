-- ─────────────────────────────────────────────
-- 089 · notify_failures table for ops visibility
--
-- Audit Task 3.5 deferred this in favor of console.error logging in
-- the send-email pipeline. That works for one-off debugging but is
-- invisible to dashboards and gets rotated out of edge-function logs.
--
-- Persisting permanent send failures lets ops:
--   • Spot a chronically bouncing recipient (bad address, mailbox full).
--   • Detect Resend rate-limit storms (many failures clustered in time).
--   • Audit "we tried to email X about Y, it failed permanently" without
--     having to grep eight different function log streams.
--
-- ONLY permanent (non-retryable) failures land here. Transient failures
-- are already retried inside _shared/email.ts (3 attempts) and rolled
-- back via the per-function release-claim path. Logging every transient
-- attempt would flood the table.
--
-- Writes happen automatically when a caller passes `opts.source` to
-- sendEmail() and the result comes back !ok && !retryable. See the
-- _shared/email.ts changes in the same commit.
-- ─────────────────────────────────────────────

create table if not exists public.notify_failures (
  id              uuid primary key default gen_random_uuid(),
  source          text not null,           -- 'notify' | 'send-alerts' | 'dm-offline-notify' | 'notification-digest' | 'hub-mention-notify'
  recipient_email text,                    -- best-effort; null if we sent to multiple
  subject         text,
  http_status     int,                     -- Resend response status (0 = network exhausted retries)
  retryable       boolean not null,        -- always false for now (only permanent failures land here), kept for future
  error_message   text,
  context         jsonb,                   -- function-specific details (task_id, conversation_id, recurrence_id, etc.)
  created_at      timestamptz not null default now()
);

create index if not exists idx_notify_failures_source_created
  on public.notify_failures (source, created_at desc);

create index if not exists idx_notify_failures_recipient
  on public.notify_failures (recipient_email)
  where recipient_email is not null;

-- ── RLS: Admin SELECT only; INSERTs only via service role ────
alter table public.notify_failures enable row level security;

create policy "notify_failures readable by admin"
  on public.notify_failures for select
  to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  );

-- No INSERT policy exposed to clients. Service role bypasses RLS, so
-- _shared/email.ts (which uses the service-role admin client) can write.

-- ── Retention: prune entries older than 90 days, nightly at 04:00 UTC ──
create or replace function public.prune_notify_failures()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  deleted_count int;
begin
  with d as (
    delete from public.notify_failures
     where created_at < now() - interval '90 days'
    returning 1
  )
  select count(*)::int into deleted_count from d;
  return coalesce(deleted_count, 0);
end;
$$;

revoke all on function public.prune_notify_failures() from public;

select cron.unschedule('prune-notify-failures')
  where exists (select 1 from cron.job where jobname = 'prune-notify-failures');

select cron.schedule(
  'prune-notify-failures',
  '0 4 * * *',
  $$select public.prune_notify_failures();$$
);

comment on table public.notify_failures is
  'Persistent log of permanent (non-retryable) Resend send failures. Written by _shared/email.ts when opts.source is provided. Pruned nightly at 04:00 UTC after 90 days. Admin-readable via RLS.';
