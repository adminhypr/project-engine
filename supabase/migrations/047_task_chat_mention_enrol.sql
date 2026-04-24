-- ─────────────────────────────────────────────
-- 047 · Task chat — auto-enrol mentioned users
--
-- When a dm_message on a kind='task' conversation @mentions someone
-- who isn't yet a participant, add them. Mirrors the hub_mentions
-- pattern. Externals (Agent/Client) are skipped unless they were
-- already participants.
--
-- Note: dm_messages.mentions is jsonb of shape
--   [{ "user_id": "<uuid>", "display_name": "<name>" }, ...]
-- (see migrations 027 + 035). We iterate with jsonb_array_elements.
-- ─────────────────────────────────────────────

create or replace function public.auto_enrol_mentioned_in_task_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_kind text;
  mentioned_id uuid;
  is_ext boolean;
begin
  select kind into conv_kind from public.conversations where id = new.conversation_id;
  if conv_kind is distinct from 'task' then return new; end if;

  if new.mentions is null or jsonb_typeof(new.mentions) <> 'array' then
    return new;
  end if;

  for mentioned_id in
    select (elem ->> 'user_id')::uuid
      from jsonb_array_elements(new.mentions) elem
     where elem ? 'user_id'
  loop
    if mentioned_id is null then continue; end if;

    -- Skip externals unless already a participant
    select public.is_external_user(mentioned_id) into is_ext;
    if is_ext and not exists (
      select 1 from public.conversation_participants
       where conversation_id = new.conversation_id and user_id = mentioned_id
    ) then
      continue;
    end if;

    -- Upsert with last_read_at slightly in the past so this message flags
    -- as unread for them immediately.
    insert into public.conversation_participants (conversation_id, user_id, last_read_at)
      values (new.conversation_id, mentioned_id, now() - interval '1 second')
      on conflict do nothing;
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_auto_enrol_task_chat_mentions on public.dm_messages;
create trigger trg_auto_enrol_task_chat_mentions
  after insert on public.dm_messages
  for each row execute function public.auto_enrol_mentioned_in_task_chat();
