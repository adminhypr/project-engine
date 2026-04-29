-- ─────────────────────────────────────────────
-- 071 · Card comment counts RPC
--
-- The deployed PostgREST does not support aggregate functions in SELECT
-- (PGRST123: "Use of aggregate functions is not allowed"), so the original
-- plan's `comments.select('card_id, id.count()')` query in useHubCards
-- silently returned zero counts on every card.
--
-- This RPC mirrors `get_user_task_chat_unreads` from migration 052: one
-- aggregation per call, scoped to the current Card Table module, returning
-- (card_id, comment_count) pairs. RLS on `comments` already gates which
-- rows the caller can see; the function runs SECURITY INVOKER so the
-- caller's view is what's counted.
-- ─────────────────────────────────────────────

create or replace function public.get_card_comment_counts(p_module_id uuid)
returns table (card_id uuid, comment_count int)
language sql
security invoker
set search_path = public
stable
as $$
  select co.card_id, count(*)::int as comment_count
    from public.comments co
    join public.hub_cards hc on hc.id = co.card_id
   where hc.module_id = p_module_id
     and co.card_id is not null
   group by co.card_id;
$$;

grant execute on function public.get_card_comment_counts(uuid) to authenticated;
