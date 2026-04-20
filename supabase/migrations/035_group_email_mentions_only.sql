-- ─────────────────────────────────────────────
-- 035 · Group email notifications fire only on @mention
--
-- Spam guard for active group conversations. Previously every unread
-- participant got an email 3 minutes after each message; in a busy group
-- that's unusably noisy. Now groups follow the industry-standard default:
-- you only get an email if you were explicitly mentioned. 1:1 DMs keep
-- their original "email on any unread" behavior.
--
-- Per-user overrides (all / mentions / none per channel) can layer on
-- later; this change ships the sane default first.
-- ─────────────────────────────────────────────

create or replace function public.enqueue_dm_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_kind text;
begin
  if new.kind <> 'user' then return new; end if;

  select kind into conv_kind
    from public.conversations
    where id = new.conversation_id;

  if conv_kind = 'group' then
    -- Groups: only email users whose id appears in new.mentions.
    -- mentions jsonb shape: [{ user_id, display_name }, ...]
    insert into public.pending_dm_emails (message_id, conversation_id, recipient_id)
      select new.id, new.conversation_id, cp.user_id
      from public.conversation_participants cp
      where cp.conversation_id = new.conversation_id
        and cp.user_id <> new.author_id
        and cp.muted = false
        and exists (
          select 1
          from jsonb_array_elements(coalesce(new.mentions, '[]'::jsonb)) m
          where (m->>'user_id')::uuid = cp.user_id
        );
  else
    -- 1:1 DMs: original behavior unchanged.
    insert into public.pending_dm_emails (message_id, conversation_id, recipient_id)
      select new.id, new.conversation_id, cp.user_id
      from public.conversation_participants cp
      where cp.conversation_id = new.conversation_id
        and cp.user_id <> new.author_id
        and cp.muted = false;
  end if;

  return new;
end;
$$;

-- Trigger definition itself is unchanged (it already calls enqueue_dm_email
-- on each dm_messages INSERT). Replacing the function body swaps the
-- behavior in place, no trigger drop needed.
