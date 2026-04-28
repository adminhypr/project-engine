-- ─────────────────────────────────────────────
-- 064 · Hub chat unified into conversations
--
-- Replaces the parallel hub_chat_messages system with a kind='hub'
-- conversation per hub. Mirrors migration 046's task-chat pattern.
-- After this migration:
--   · conversations gets hub_id + kind='hub'
--   · One auto-created conversation per hubs row
--   · conversation_participants stays in sync with hub_members (insert + delete)
--   · Externals (Agent/Client) who are hub_members can read/post hub chat
--     under the same RLS extensions used for group/task chat
--   · enqueue_dm_email + digest renderer treat 'hub' the same as 'group'
--   · hub_chat_messages table is DROPPED (clean cut-over, no backfill)
--
-- Frontend follow-up: useHubChat repoints to dm_messages filtered by the
-- hub conversation. The chat widget surfaces these in the same GROUPS
-- section as team groups.
-- ─────────────────────────────────────────────

-- 1. Extend conversations
alter table public.conversations
  add column if not exists hub_id uuid references public.hubs(id) on delete cascade;

create unique index if not exists conversations_hub_uniq
  on public.conversations(hub_id)
  where kind = 'hub' and hub_id is not null;

-- Re-issue the CHECK to add 'hub'. Migration 046 set the constraint to
-- ('dm','group','task'); we extend it.
alter table public.conversations
  drop constraint if exists conversations_kind_check;
alter table public.conversations
  add constraint conversations_kind_check
  check (kind in ('dm','group','task','hub'));

-- ─────────────────────────────────────────────
-- 2. RPC: get-or-create the conversation for a given hub.
--    SECURITY DEFINER so it can be called by triggers and by hub
--    members through the API; caller must be a hub_member or admin.
-- ─────────────────────────────────────────────
create or replace function public.get_or_create_hub_conversation(hid uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller   uuid := auth.uid();
  existing uuid;
  new_id   uuid;
  hname    text;
  hcreator uuid;
  is_service_or_trigger boolean;
begin
  if hid is null then raise exception 'hub id required'; end if;

  -- The auto-create trigger on `hubs` calls this through the trigger
  -- context where auth.uid() is null. Allow that path; otherwise the
  -- caller must be a hub member or an admin (mirrors migration 043's
  -- caller-is-member exception for service contexts).
  is_service_or_trigger := caller is null;

  select id into existing
  from public.conversations
   where kind = 'hub' and hub_id = hid
  limit 1;
  if existing is not null then
    if not is_service_or_trigger
       and not exists (select 1 from public.hub_members where hub_id = hid and profile_id = caller)
       and not exists (select 1 from public.profiles where id = caller and role = 'Admin')
    then
      raise exception 'not a hub member';
    end if;
    return existing;
  end if;

  select name, created_by into hname, hcreator from public.hubs where id = hid;
  if hname is null then raise exception 'hub not found'; end if;

  insert into public.conversations (kind, hub_id, title, created_by)
    values ('hub', hid, hname, hcreator)
    returning id into new_id;
  return new_id;
end;
$$;
grant execute on function public.get_or_create_hub_conversation(uuid) to authenticated;

-- ─────────────────────────────────────────────
-- 3. Trigger: create hub conversation on hub insert + seed creator
-- ─────────────────────────────────────────────
create or replace function public.create_hub_chat_on_hub_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
begin
  conv_id := public.get_or_create_hub_conversation(new.id);

  if conv_id is not null and new.created_by is not null then
    insert into public.conversation_participants (conversation_id, user_id, last_read_at)
      values (conv_id, new.created_by, now())
      on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_create_hub_chat_on_hub_insert on public.hubs;
create trigger trg_create_hub_chat_on_hub_insert
  after insert on public.hubs
  for each row execute function public.create_hub_chat_on_hub_insert();

-- ─────────────────────────────────────────────
-- 4. Trigger: keep conversation.title in sync if a hub is renamed.
--    No-op if the hub conversation row hasn't been created yet
--    (defensive — backfill below should always create one).
-- ─────────────────────────────────────────────
create or replace function public.sync_hub_conversation_title()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.conversations
       set title = new.name
     where kind = 'hub' and hub_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_hub_conversation_title on public.hubs;
create trigger trg_sync_hub_conversation_title
  after update of name on public.hubs
  for each row execute function public.sync_hub_conversation_title();

-- ─────────────────────────────────────────────
-- 5. Trigger: sync conversation_participants on hub_members INSERT
-- ─────────────────────────────────────────────
create or replace function public.sync_hub_chat_participant_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
begin
  conv_id := public.get_or_create_hub_conversation(new.hub_id);
  if conv_id is null then return new; end if;

  insert into public.conversation_participants (conversation_id, user_id, last_read_at)
    values (conv_id, new.profile_id, now())
    on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_sync_hub_chat_participant_insert on public.hub_members;
create trigger trg_sync_hub_chat_participant_insert
  after insert on public.hub_members
  for each row execute function public.sync_hub_chat_participant_insert();

-- ─────────────────────────────────────────────
-- 6. Trigger: remove from conversation_participants on hub_members DELETE
-- ─────────────────────────────────────────────
create or replace function public.sync_hub_chat_participant_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
begin
  select id into conv_id from public.conversations
   where kind = 'hub' and hub_id = old.hub_id;
  if conv_id is null then return old; end if;

  delete from public.conversation_participants
   where conversation_id = conv_id and user_id = old.profile_id;

  return old;
end;
$$;

drop trigger if exists trg_sync_hub_chat_participant_delete on public.hub_members;
create trigger trg_sync_hub_chat_participant_delete
  after delete on public.hub_members
  for each row execute function public.sync_hub_chat_participant_delete();

-- ─────────────────────────────────────────────
-- 7. Backfill: create a conversation for every existing hub + seed
--    all current hub_members as participants.
-- ─────────────────────────────────────────────
do $$
declare
  h record;
begin
  for h in select id from public.hubs loop
    perform public.get_or_create_hub_conversation(h.id);
  end loop;
end $$;

-- Seed creators (covers hubs that existed before the trigger was added)
insert into public.conversation_participants (conversation_id, user_id, last_read_at)
select c.id, h.created_by, now()
from public.conversations c
join public.hubs h on h.id = c.hub_id
where c.kind='hub'
  and h.created_by is not null
on conflict do nothing;

-- Seed all hub_members as participants
insert into public.conversation_participants (conversation_id, user_id, last_read_at)
select c.id, hm.profile_id, now()
from public.conversations c
join public.hub_members hm on hm.hub_id = c.hub_id
where c.kind='hub'
on conflict do nothing;

-- ─────────────────────────────────────────────
-- 8. Extend external/participant RLS policies (originally from 046).
--    Adds 'hub' alongside 'task' and team-group. Externals who are
--    hub_members are conversation_participants by virtue of triggers
--    above, so the existing is_conversation_participant() check is
--    enough for the *participant* gate; this section only relaxes the
--    *external-user* restriction so 'hub' is in their allow-list.
-- ─────────────────────────────────────────────
drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant" on public.conversations
  for select
  using (
    (
      public.is_conversation_participant(id)
      or (
        kind = 'task'
        and task_id is not null
        and exists (select 1 from public.tasks t where t.id = conversations.task_id)
      )
    )
    and (
      not public.is_external_user(auth.uid())
      or (kind = 'group' and team_id is not null)
      or kind = 'task'
      or kind = 'hub'
    )
  );

drop policy if exists "dm_messages_insert_participant" on public.dm_messages;
create policy "dm_messages_insert_participant" on public.dm_messages
  for insert
  with check (
    public.is_conversation_participant(conversation_id)
    and author_id = auth.uid()
    and (
      not public.is_external_user(auth.uid())
      or exists (
        select 1 from public.conversations c
        where c.id = conversation_id
          and (
            (c.kind = 'group' and c.team_id is not null)
            or c.kind = 'task'
            or c.kind = 'hub'
          )
      )
    )
  );

drop policy if exists "dm_messages_select_participant" on public.dm_messages;
create policy "dm_messages_select_participant" on public.dm_messages
  for select using (
    public.is_conversation_participant(conversation_id)
    and (
      not public.is_external_user(auth.uid())
      or exists (
        select 1 from public.conversations c
        where c.id = conversation_id
          and (
            (c.kind = 'group' and c.team_id is not null)
            or c.kind = 'task'
            or c.kind = 'hub'
          )
      )
    )
  );

-- ─────────────────────────────────────────────
-- 9. Email queueing (mig 035 → 050) — add 'hub' to the
--    "mention-only-for-non-DMs" branch so hub chat behaves like team
--    groups: only @mentioned recipients receive an offline email.
-- ─────────────────────────────────────────────
create or replace function public.enqueue_dm_email()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  conv_kind text;
  rec_id    uuid;
  is_mentioned boolean;
begin
  if new.deleted_at is not null then return new; end if;

  select kind into conv_kind
  from public.conversations
  where id = new.conversation_id;

  for rec_id in
    select user_id from public.conversation_participants
     where conversation_id = new.conversation_id
       and user_id <> new.author_id
  loop
    if conv_kind in ('group', 'task', 'hub') then
      is_mentioned := false;
      if new.mentions is not null and jsonb_typeof(new.mentions) = 'array' then
        is_mentioned := exists (
          select 1 from jsonb_array_elements(new.mentions) m
           where (m->>'user_id')::uuid = rec_id
        );
      end if;
      if not is_mentioned then continue; end if;
    end if;

    insert into public.pending_dm_emails (conversation_id, message_id, recipient_id)
      values (new.conversation_id, new.id, rec_id);
  end loop;

  return new;
end;
$$;

-- ─────────────────────────────────────────────
-- 10. Notification outbox — extend the dm_messages enqueue trigger to
--     emit hub-chat events. Routes through group_message/group_mention
--     event types (re-using the digest section) but sets payload
--     conversation_kind='hub' + hub_name so the digest renderer can
--     label it correctly.
-- ─────────────────────────────────────────────
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
  if conv is null then return new; end if;
  if new.deleted_at is not null then return new; end if;

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

    is_mentioned := false;
    if new.mentions is not null and jsonb_typeof(new.mentions) = 'array' then
      is_mentioned := exists (
        select 1 from jsonb_array_elements(new.mentions) m
         where (m->>'user_id')::uuid = participant_id
      );
    end if;

    if conv.kind = 'task' then
      event_type_val := case when is_mentioned then 'task_chat_mention' else 'task_chat_message' end;
    elsif conv.kind = 'group' or conv.kind = 'hub' then
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
         'snippet',           left(coalesce(new.content, ''), 140),
         'is_mention',        is_mentioned
       ),
       'dm_messages', new.id);
  end loop;
  return new;
end;
$$;

-- ─────────────────────────────────────────────
-- 11. Drop the old hub_chat_messages table.
--
-- Cleanup of legacy rows in hub_mentions:
--   hub_mentions.entity_type='chat' rows pointed at hub_chat_messages
--   ids; with the table gone they can never be resolved. Delete them.
--   message_board / check-in mentions stay (entity_type<>'chat').
-- ─────────────────────────────────────────────
delete from public.hub_mentions where entity_type = 'chat';

drop table if exists public.hub_chat_messages cascade;
