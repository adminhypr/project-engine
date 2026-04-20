-- ─────────────────────────────────────────────
-- 031 · Stream conversation_participants changes so senders can see
-- when the other participant's last_read_at advances ("seen" status).
-- ─────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversation_participants'
  ) then
    alter publication supabase_realtime add table public.conversation_participants;
  end if;
end $$;
