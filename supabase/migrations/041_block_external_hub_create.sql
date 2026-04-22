-- ─────────────────────────────────────────────
-- 041 · Block externals (Agent/Client) from creating hubs
--
-- Agents and clients join hubs by explicit invite only. They must not be
-- able to create their own hubs. UI hides the "New Hub" button, the hook
-- short-circuits, and this RLS policy enforces the rule at the DB layer.
-- ─────────────────────────────────────────────

drop policy if exists "hubs_insert" on public.hubs;
create policy "hubs_insert" on public.hubs
  for insert
  with check (
    created_by = auth.uid()
    and not public.is_external_user(auth.uid())
  );
