-- supabase/migrations/034_dm_message_reactions.sql
-- Messenger-style emoji reactions on DM messages.

------------------------------------------------------------
-- Table
------------------------------------------------------------
create table if not exists public.dm_message_reactions (
  message_id  uuid not null references public.dm_messages(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists dm_message_reactions_message_idx
  on public.dm_message_reactions(message_id);

------------------------------------------------------------
-- RLS
------------------------------------------------------------
-- Participants in the parent conversation can SELECT any reaction.
-- Users may INSERT / DELETE only their own rows, and only when they are
-- a participant in the parent conversation. We derive conversation_id
-- from dm_messages via a scalar subquery, then delegate to the existing
-- SECURITY DEFINER helper `is_conversation_participant(uuid)` — this
-- avoids the usual policy-recursion pitfalls.
------------------------------------------------------------
alter table public.dm_message_reactions enable row level security;

drop policy if exists "dm_reactions_select_participant" on public.dm_message_reactions;
create policy "dm_reactions_select_participant" on public.dm_message_reactions
  for select using (
    public.is_conversation_participant(
      (select m.conversation_id from public.dm_messages m where m.id = message_id)
    )
  );

drop policy if exists "dm_reactions_insert_own" on public.dm_message_reactions;
create policy "dm_reactions_insert_own" on public.dm_message_reactions
  for insert with check (
    user_id = auth.uid()
    and public.is_conversation_participant(
      (select m.conversation_id from public.dm_messages m where m.id = message_id)
    )
  );

drop policy if exists "dm_reactions_delete_own" on public.dm_message_reactions;
create policy "dm_reactions_delete_own" on public.dm_message_reactions
  for delete using (user_id = auth.uid());
-- No UPDATE: reactions are immutable (delete + insert to change).

------------------------------------------------------------
-- Realtime publication
------------------------------------------------------------
alter publication supabase_realtime add table public.dm_message_reactions;
