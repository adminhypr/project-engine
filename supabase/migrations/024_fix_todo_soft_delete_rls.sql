-- ─────────────────────────────────────────────
-- 024 · Fix Todo soft-delete under PG17 RLS
--
-- PG17 RLS enforces the SELECT policy on the post-update row,
-- so setting `deleted_at` to a non-null value on a SELECT policy
-- that requires `deleted_at IS NULL` fails with
-- "new row violates row-level security policy".
--
-- Move the deleted_at filter out of RLS; the app already
-- filters `.is('deleted_at', null)` in useHubTodos.fetchData.
-- ─────────────────────────────────────────────

drop policy if exists "hub_todo_lists_select" on public.hub_todo_lists;
create policy "hub_todo_lists_select" on public.hub_todo_lists for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_lists.hub_id and hm.profile_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

drop policy if exists "hub_todo_items_select" on public.hub_todo_items;
create policy "hub_todo_items_select" on public.hub_todo_items for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_items.hub_id and hm.profile_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);
