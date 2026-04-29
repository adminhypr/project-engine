-- ─────────────────────────────────────────────
-- 078 · Notification outbox: atomic claim column
--
-- Adds claimed_at to notification_outbox so the digest can claim rows
-- before sending. The 062 partial index is replaced with one that
-- excludes both emailed AND claimed rows.
--
-- Stale-claim recovery: the digest must call reset_stale_outbox_claims()
-- as its first step. That clears any claim older than the digest's own
-- timeout budget (10 min), at which point the row's claimed_at returns
-- to NULL and it re-enters the index naturally.
--
-- Why no time window in the index predicate: partial-index predicates
-- must be IMMUTABLE; now() is STABLE. Putting time-comparison in the
-- index would make it un-creatable. Single source of truth for stale
-- recovery (the helper) is the cleaner architecture anyway.
-- ─────────────────────────────────────────────

alter table public.notification_outbox
  add column if not exists claimed_at timestamptz;

drop index if exists idx_notif_outbox_pending_email;
create index if not exists idx_notif_outbox_pending
  on public.notification_outbox (recipient_id, created_at)
  where emailed_at is null
    and claimed_at is null;

-- Helper: reset abandoned claims (used by the digest as its first step).
-- 10 min = the digest's invocation timeout budget; anything older than
-- that must have crashed mid-run.
create or replace function public.reset_stale_outbox_claims()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  reset_count int;
begin
  with u as (
    update public.notification_outbox
       set claimed_at = null
     where emailed_at is null
       and claimed_at is not null
       and claimed_at < now() - interval '10 minutes'
    returning 1
  )
  select count(*)::int into reset_count from u;
  return coalesce(reset_count, 0);
end;
$$;
