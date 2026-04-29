-- ─────────────────────────────────────────────
-- 078 · Notification outbox: atomic claim column
--
-- Adds claimed_at to notification_outbox so the digest can claim rows
-- before sending. The 062 partial index is replaced with one that
-- excludes both emailed and recently-claimed rows. Stale claims (older
-- than 10 min, the digest's own timeout budget) are reclaimable.
-- ─────────────────────────────────────────────

alter table public.notification_outbox
  add column if not exists claimed_at timestamptz;

drop index if exists idx_notif_outbox_pending_email;
create index if not exists idx_notif_outbox_pending
  on public.notification_outbox (recipient_id, created_at)
  where emailed_at is null
    and (claimed_at is null or claimed_at < now() - interval '10 minutes');

-- Helper: reset abandoned claims (used by the digest as its first step).
create or replace function public.reset_stale_outbox_claims()
returns int
language sql
volatile
security definer
set search_path = public
as $$
  update public.notification_outbox
     set claimed_at = null
   where emailed_at is null
     and claimed_at is not null
     and claimed_at < now() - interval '10 minutes'
  returning 1
$$;
