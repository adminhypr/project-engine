-- ─────────────────────────────────────────────
-- 085 · Add message_id / comment_id to notification payloads
--
-- Existing triggers wrote enough payload data to render TEXT in digest
-- emails (actor_name, task_title, snippet, etc.) but not enough to
-- render LINKS that open the specific message or comment.
--
-- This migration replaces three trigger functions with versions that
-- also write the source row id into the payload as message_id /
-- comment_id, alongside what they already had. No schema changes —
-- just richer payloads going forward. Backfill is unnecessary because
-- digest emails are throwaway after `emailed_at`.
--
-- - enqueue_comment_notification — adds `comment_id` to the task
--   branch; the card branch already had it.
-- - enqueue_dm_message_notification — adds `message_id`.
-- - enqueue_hub_mention_notification — already had `entity_id`; we
--   rename for clarity AND keep entity_id for back-compat.
-- ─────────────────────────────────────────────

-- 1. Task comment trigger — add comment_id (the card branch already
--    builds card_id + comment_id; only the task branch was missing it).
--    This re-implements the SAME function from migration 070 with the
--    one new key. Preserves the 070 payload shape for both branches.

create or replace function public.enqueue_comment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  watcher       uuid;
  mentioned     uuid;
  payload_json  jsonb;
  author_name   text;
  task_title_v  text;
  card_title_v  text;
  hub_id_v      uuid;
begin
  select full_name into author_name from public.profiles where id = new.author_id;

  if new.task_id is not null then
    select title into task_title_v from public.tasks where id = new.task_id;

    payload_json := jsonb_build_object(
      'actor_id',   new.author_id,
      'actor_name', coalesce(author_name, 'Someone'),
      'task_id',    new.task_id,
      'task_title', coalesce(task_title_v, 'Task'),
      'comment_id', new.id,
      'snippet',    left(coalesce(new.content, ''), 140)
    );

    for watcher in
      select distinct uid from (
        select t.assigned_to as uid from public.tasks t where t.id = new.task_id
        union
        select t.assigned_by as uid from public.tasks t where t.id = new.task_id
        union
        select ta.profile_id as uid from public.task_assignees ta where ta.task_id = new.task_id
      ) w where uid is not null and uid <> new.author_id
    loop
      insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
      values (watcher, 'comment_posted', payload_json, 'comments', new.id);
    end loop;

    if new.mentioned_ids is not null and array_length(new.mentioned_ids, 1) > 0 then
      foreach mentioned in array new.mentioned_ids loop
        if mentioned <> new.author_id then
          insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
          values (mentioned, 'comment_mention', payload_json, 'comments', new.id);
        end if;
      end loop;
    end if;

    return new;
  end if;

  if new.card_id is not null then
    select hm.hub_id, c.title into hub_id_v, card_title_v
      from public.hub_cards c
      join public.hub_modules hm on hm.id = c.module_id
     where c.id = new.card_id;

    payload_json := jsonb_build_object(
      'actor_id',   new.author_id,
      'actor_name', coalesce(author_name, 'Someone'),
      'card_id',    new.card_id,
      'hub_id',     hub_id_v,
      'card_title', coalesce(card_title_v, 'a card'),
      'comment_id', new.id,
      'snippet',    left(coalesce(new.content, ''), 140)
    );

    for watcher in
      select profile_id from public.hub_card_assignees
       where card_id = new.card_id and profile_id <> new.author_id
    loop
      insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
      values (watcher, 'card_comment', payload_json, 'comments', new.id);
    end loop;

    if new.mentioned_ids is not null and array_length(new.mentioned_ids, 1) > 0 then
      foreach mentioned in array new.mentioned_ids loop
        if mentioned <> new.author_id then
          insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
          values (mentioned, 'card_mention', payload_json, 'comments', new.id);
        end if;
      end loop;
    end if;
  end if;

  return new;
end;
$$;

-- 2. DM/group/hub-campfire/task-chat trigger — add message_id.
--    Same body as 062 but with `'message_id', new.id` added to the
--    jsonb_build_object call.

create or replace function public.enqueue_dm_message_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  conv public.conversations%rowtype;
  author_name text;
  participant_id uuid;
  is_mentioned boolean;
  event_type_val text;
  task_title_val text;
  hub_name_val text;
begin
  select * into conv from public.conversations where id = new.conversation_id;
  select full_name into author_name from public.profiles where id = new.author_id;

  if conv.kind = 'task' and conv.task_id is not null then
    select title into task_title_val from public.tasks where id = conv.task_id;
  end if;

  if conv.kind = 'hub' and conv.hub_id is not null then
    select name into hub_name_val from public.hubs where id = conv.hub_id;
  end if;

  for participant_id in
    select user_id from public.conversation_participants where conversation_id = new.conversation_id
  loop
    if participant_id = new.author_id then continue; end if;

    is_mentioned := exists (
      select 1
        from jsonb_array_elements(coalesce(new.mentions, '[]'::jsonb)) as m
       where (m ->> 'user_id')::uuid = participant_id
    );

    -- Event type by conv kind + mention.
    if conv.kind = 'task' then
      event_type_val := case when is_mentioned then 'task_chat_mention' else 'task_chat_message' end;
    elsif conv.kind = 'hub' then
      -- Hub campfire activity uses the same outbox slots as group chats.
      event_type_val := case when is_mentioned then 'group_mention' else 'group_message' end;
    elsif conv.kind = 'group' then
      event_type_val := case when is_mentioned then 'group_mention' else 'group_message' end;
    else
      event_type_val := 'dm_message';
    end if;

    insert into public.notification_outbox
      (recipient_id, event_type, payload, source_table, source_id)
    values
      (participant_id, event_type_val,
       jsonb_build_object(
         'actor_id',          new.author_id,
         'actor_name',        coalesce(author_name, 'Someone'),
         'conversation_id',   conv.id,
         'conversation_kind', conv.kind,
         'task_id',           conv.task_id,
         'task_title',        task_title_val,
         'hub_id',            conv.hub_id,
         'hub_name',          hub_name_val,
         'group_title',       conv.title,
         'message_id',        new.id,
         'snippet',           left(coalesce(new.content, ''), 140),
         'is_mention',        is_mentioned
       ),
       'dm_messages', new.id);
  end loop;
  return new;
end;
$$;

-- 3. Hub mention trigger — already writes entity_id; alias as message_id
--    for clarity in the digest renderer (entity_id can also be a
--    todo-item or non-message in some hub_mentions rows, but the digest
--    only renders the link when both message_id and hub_id are present
--    for entity_type = 'hub_message').

create or replace function public.enqueue_hub_mention_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  mentioner_name text;
  hub_name text;
begin
  if new.mentioned_user is null or new.mentioned_user = new.mentioned_by then
    return new;
  end if;
  select full_name into mentioner_name from public.profiles where id = new.mentioned_by;
  select name into hub_name from public.hubs where id = new.hub_id;

  insert into public.notification_outbox
    (recipient_id, event_type, payload, source_table, source_id)
  values
    (new.mentioned_user, 'hub_mention',
     jsonb_build_object(
       'actor_id',     new.mentioned_by,
       'actor_name',   coalesce(mentioner_name, 'Someone'),
       'hub_id',       new.hub_id,
       'hub_name',     coalesce(hub_name, 'a hub'),
       'entity_type',  new.entity_type,
       'entity_id',    new.entity_id,
       'message_id',   case when new.entity_type = 'hub_message' then new.entity_id else null end
     ),
     'hub_mentions', new.id);
  return new;
end;
$$;
