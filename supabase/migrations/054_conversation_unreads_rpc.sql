-- ─────────────────────────────────────────────
-- 054 · RPC: aggregated conversation unread counts
--
-- useConversations was doing N+1 HEAD count queries — one per
-- conversation the caller participates in. With task chats now
-- created eagerly for every task (migration 046), an admin/manager
-- typically participates in 100+ conversations, and ChatWidget
-- instantiates useConversations TWICE on every page load
-- (NotificationBell + the widget itself), so the cost compounds.
--
-- This RPC returns (conversation_id, unread_count) for every
-- conversation the caller participates in. One query, one round
-- trip, server-side aggregation. Mirrors migration 052's pattern.
-- ─────────────────────────────────────────────

create or replace function public.get_user_conversation_unreads()
returns table(conversation_id uuid, unread_count bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select cp.conversation_id,
         count(m.id) filter (
           where m.author_id <> cp.user_id
             and m.created_at > coalesce(cp.last_read_at, 'epoch'::timestamptz)
             and m.deleted_at is null
         ) as unread_count
    from public.conversation_participants cp
    left join public.dm_messages m
      on m.conversation_id = cp.conversation_id
   where cp.user_id = auth.uid()
   group by cp.conversation_id;
$$;

grant execute on function public.get_user_conversation_unreads() to authenticated;
