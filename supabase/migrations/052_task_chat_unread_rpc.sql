-- ─────────────────────────────────────────────
-- 052 · RPC: aggregated task-chat unread counts
--
-- useTasks was doing N+1 count queries for per-task unread chat
-- badges (one participant-list fetch + one HEAD count per task
-- conversation). For an Admin with 100+ tasks this stalled the
-- My Tasks page for 4–6 seconds purely to paint a row-level icon.
--
-- This RPC returns (task_id, unread_count) for every kind='task'
-- conversation the caller participates in, filtered to a caller-
-- supplied task_ids list. One query, one round trip, server-side
-- aggregation.
-- ─────────────────────────────────────────────

create or replace function public.get_user_task_chat_unreads(p_task_ids uuid[])
returns table(task_id uuid, unread_count bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select c.task_id, count(m.id) as unread_count
    from public.conversation_participants cp
    join public.conversations c
      on c.id = cp.conversation_id
     and c.kind = 'task'
     and c.task_id = any(p_task_ids)
    left join public.dm_messages m
      on m.conversation_id = cp.conversation_id
     and m.author_id <> cp.user_id
     and m.created_at > coalesce(cp.last_read_at, 'epoch'::timestamptz)
     and m.deleted_at is null
   where cp.user_id = auth.uid()
   group by c.task_id;
$$;

grant execute on function public.get_user_task_chat_unreads(uuid[]) to authenticated;
