-- ─────────────────────────────────────────────
-- 048 · Allow externals to send messages in task chat
--
-- The bump_conversation_last_message trigger from 027 runs as the
-- session user. When an external (Agent/Client) inserts a
-- dm_messages row on a kind='task' conversation, RLS on the INSERT
-- passes per 046, but the trigger's UPDATE of
-- conversations.last_message_at is rejected by the 042
-- conversations_update_participant policy that only whitelists
-- kind='group' AND team_id IS NOT NULL for externals. The whole
-- INSERT rolls back.
--
-- Fix: make the trigger SECURITY DEFINER (matches every other
-- write-trigger convention in this codebase). Body preserved
-- verbatim from 027.
-- ─────────────────────────────────────────────

create or replace function public.bump_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
    set last_message_at      = new.created_at,
        last_message_preview = left(coalesce(new.content, ''), 140)
    where id = new.conversation_id;
  return new;
end;
$$;
