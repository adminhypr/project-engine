-- ─────────────────────────────────────────────
-- 080 · DM email debounce uniqueness
--
-- The dm-offline-notify function previously checked dm_email_log then
-- inserted later; two parallel runs both pass the check and double-send.
-- Add a unique constraint scoped to (recipient, conversation, time_bucket)
-- so a "claim BEFORE send" pattern can use ON CONFLICT to make at most
-- one worker per 15-minute window send the email.
--
-- Bucket = 15-minute window. Postgres generated columns require a
-- truly IMMUTABLE expression. The earlier draft tried
--   to_timestamp(floor(extract(epoch from sent_at) / 900) * 900)
-- but `extract(epoch from timestamptz)` is declared STABLE (its
-- volatility is conservative because the catalog can't prove
-- timezone-independence at the function-signature level). Postgres
-- rejected the generated column with "generation expression is not
-- immutable" (SQLSTATE 42P17).
--
-- Workaround: wrap the bucket math in a SQL function declared
-- IMMUTABLE. The expression body uses STABLE pieces, but for a
-- timestamptz input the epoch IS truly UTC-anchored at storage level
-- — the result is a deterministic function of the input bytes. The
-- IMMUTABLE label is safe and standard practice for this pattern.
--
-- The existing PK on dm_email_log is (recipient_id, conversation_id,
-- sent_at) from migration 028 — that uniqueness is too loose (sent_at
-- varies down to the microsecond). The new unique index sits alongside
-- the PK and provides the 15-min bucket dedupe we need.
-- ─────────────────────────────────────────────

create or replace function public.dm_email_bucket_15min(t timestamptz)
returns timestamptz
language sql
immutable
as $$
  select to_timestamp(floor(extract(epoch from t) / 900) * 900)
$$;

alter table public.dm_email_log
  add column if not exists time_bucket timestamptz
    generated always as (public.dm_email_bucket_15min(sent_at)) stored;

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
