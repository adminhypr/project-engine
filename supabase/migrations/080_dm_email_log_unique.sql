-- ─────────────────────────────────────────────
-- 080 · DM email debounce uniqueness
--
-- The dm-offline-notify function previously checked dm_email_log then
-- inserted later; two parallel runs both pass the check and double-send.
-- Add a unique constraint scoped to (recipient, conversation, time_bucket)
-- so a "claim BEFORE send" pattern can use ON CONFLICT to make at most
-- one worker per 15-minute window send the email.
--
-- Bucket = 15-minute window. Postgres generated columns require an
-- IMMUTABLE expression. `date_trunc('minute', sent_at)` is STABLE
-- (it depends on session timezone for timestamptz inputs), so it cannot
-- be used in a generated column. Instead we floor the epoch seconds:
--   to_timestamp(floor(extract(epoch from sent_at) / 900) * 900)
-- Both `extract(epoch from timestamptz)` and `to_timestamp(double)` are
-- IMMUTABLE, so the composed expression is IMMUTABLE and accepted by
-- a generated column.
--
-- The existing PK on dm_email_log is (recipient_id, conversation_id,
-- sent_at) from migration 028 — that uniqueness is too loose (sent_at
-- varies down to the microsecond). The new unique index sits alongside
-- the PK and provides the 15-min bucket dedupe we need.
-- ─────────────────────────────────────────────

alter table public.dm_email_log
  add column if not exists time_bucket timestamptz
    generated always as (
      to_timestamp(floor(extract(epoch from sent_at) / 900) * 900)
    ) stored;

-- Dedupe historic rows that share a (recipient, conversation, bucket)
-- before adding the unique index.
delete from public.dm_email_log a
 using public.dm_email_log b
 where a.ctid > b.ctid
   and a.recipient_id = b.recipient_id
   and a.conversation_id = b.conversation_id
   and a.time_bucket = b.time_bucket;

create unique index if not exists uq_dm_email_log_debounce
  on public.dm_email_log (recipient_id, conversation_id, time_bucket);
