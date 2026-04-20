-- ─────────────────────────────────────────────
-- 032 · Reply-to-message support on dm_messages
-- Self-reference + denormalized snapshot so replies render instantly
-- without loading the original row (which may be scrolled out of range
-- or soft-deleted).
-- ─────────────────────────────────────────────

alter table public.dm_messages
  add column if not exists reply_to_id        uuid references public.dm_messages(id) on delete set null,
  add column if not exists reply_to_author_id uuid references public.profiles(id)    on delete set null,
  add column if not exists reply_to_preview   text;

create index if not exists dm_messages_reply_to_idx
  on public.dm_messages(reply_to_id)
  where reply_to_id is not null;
