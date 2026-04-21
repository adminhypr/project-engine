-- ─────────────────────────────────────────────
-- 037 · Slack-style threads on direct messages
--
-- A thread is a set of messages that reply to a specific root message and
-- don't appear in the main chat stream. The root message itself stays in
-- the main stream; replies live only in the thread's side panel.
--
-- One flat level of nesting only (Slack convention): replying to a reply
-- lands in the same thread as the reply. No nested sub-threads.
--
-- Existing `reply_to_id` (quote-reply feature) is unaffected and works
-- inside threads too.
-- ─────────────────────────────────────────────

alter table public.dm_messages
  add column if not exists thread_root_id uuid references public.dm_messages(id) on delete cascade;

-- Fast thread-count + thread-load queries.
create index if not exists dm_messages_thread_root_idx
  on public.dm_messages(thread_root_id, created_at)
  where thread_root_id is not null;

-- Helper: count + latest reply per root ids. Client uses this to render
-- "N replies · last reply Xmin ago" footers without fetching full thread
-- contents for every root on the screen.
create or replace function public.dm_thread_counts(root_ids uuid[])
returns table (
  thread_root_id  uuid,
  reply_count     bigint,
  last_reply_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    thread_root_id,
    count(*) as reply_count,
    max(created_at) as last_reply_at
  from public.dm_messages
  where thread_root_id = any(root_ids)
    and deleted_at is null
  group by thread_root_id
$$;
grant execute on function public.dm_thread_counts(uuid[]) to authenticated;
