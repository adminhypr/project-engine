-- ─────────────────────────────────────────────
-- 106 · Video calls in chat (Google Meet)
--
-- Extends dm_messages.kind to allow 'call'. A call is a NORMAL message —
-- real sender (the person who started it), real bump/notifications — whose
-- content carries a Google Meet link; the renderer shows a "Join call" card
-- instead of a plain bubble. The `create-meet-link` edge function inserts
-- these rows (service role) after verifying the caller is a participant in
-- the conversation.
--
-- Purely additive: one CHECK-constraint widening. No new tables, no RLS /
-- trigger / column changes. Existing rows are all 'user'/'system' and stay
-- valid. Old clients that don't know 'call' render the row as a normal text
-- bubble (the Meet URL in the body is still a clickable link) — graceful
-- degradation, nothing breaks. Reversible.
--
-- The inline CHECK from migration 027 is named `dm_messages_kind_check` by
-- Postgres convention; drop-if-exists handles it. NOT VALID + VALIDATE keeps
-- the rewrite lock light on a large table (all existing rows already satisfy
-- the new predicate).
-- ─────────────────────────────────────────────

alter table public.dm_messages drop constraint if exists dm_messages_kind_check;

alter table public.dm_messages
  add constraint dm_messages_kind_check
  check (kind in ('user', 'system', 'call')) not valid;

alter table public.dm_messages validate constraint dm_messages_kind_check;
