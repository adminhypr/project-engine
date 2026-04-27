-- ─────────────────────────────────────────────
-- 055 · RPC: aggregated task comment counts
--
-- TASK_SELECT_FULL was using a nested `comments(count)` PostgREST
-- embed to fetch the comment-count badge. PostgREST compiles that
-- into a LATERAL count() per row — for an admin pulling 100+ tasks
-- this sits in the hot path of every My Tasks load.
--
-- This RPC returns (task_id, comment_count) for every task the
-- caller can read (RLS filters automatically since SECURITY INVOKER).
-- One round trip, server-side aggregation.
-- ─────────────────────────────────────────────

create or replace function public.get_user_task_comment_counts()
returns table(task_id uuid, comment_count bigint)
language sql
security invoker
stable
set search_path = public
as $$
  select t.id as task_id, count(c.id) as comment_count
    from public.tasks t
    left join public.comments c on c.task_id = t.id
   group by t.id;
$$;

grant execute on function public.get_user_task_comment_counts() to authenticated;
