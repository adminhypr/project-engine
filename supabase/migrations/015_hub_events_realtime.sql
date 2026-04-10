-- ─────────────────────────────────────────────
-- 015 · Add hub_events to realtime publication
-- (missed in 014)
-- ─────────────────────────────────────────────

alter publication supabase_realtime add table public.hub_events;
