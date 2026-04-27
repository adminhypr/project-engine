-- ─────────────────────────────────────────────
-- 062 · Notification outbox + presence-aware email digest
--
-- Goals (per David's audit ask):
--   • Bell stays real-time; covers every event (task assigned, comment
--     posted, message sent, mentions).
--   • Email is for OFFLINE users only, batched into a 15-minute digest
--     instead of per-event blasts.
--
-- This migration adds:
--   • profiles.last_seen_at (presence heartbeat from frontend)
--   • profiles.email_digest_enabled (per-user opt-out)
--   • comments.mentioned_ids (array — task comments now have @mention support)
--   • notification_outbox (queue of all events that COULD email)
--   • Triggers that enqueue rows on task_assignees / comments / dm_messages
--     / hub_mentions inserts. Triggers skip self-notifications (you don't
--     get a row for events you initiated).
--
-- Phase 1 of two; phase 2 (the digest edge function + per-event email
-- skip-if-online refactor of existing functions) follows.
-- ─────────────────────────────────────────────

-- ── Profiles: presence + digest opt-out ──────────────────────
alter table public.profiles
  add column if not exists last_seen_at timestamptz default now();
alter table public.profiles
  add column if not exists email_digest_enabled boolean not null default true;

create index if not exists idx_profiles_last_seen_at
  on public.profiles(last_seen_at) where last_seen_at is not null;

-- The existing migration 042 self-update guard only rejects updates where
-- role / team_id / reports_to / email change. last_seen_at and
-- email_digest_enabled are NOT in that deny list, so self-updates of these
-- two new columns will pass through with no further changes needed.

-- ── Comments: @mention support ───────────────────────────────
alter table public.comments
  add column if not exists mentioned_ids uuid[] not null default array[]::uuid[];

create index if not exists idx_comments_mentioned_ids
  on public.comments using gin(mentioned_ids);

-- ── notification_outbox ──────────────────────────────────────
create table if not exists public.notification_outbox (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  event_type    text not null check (event_type in (
    'task_assigned',
    'task_completed',
    'task_declined',
    'task_reassigned',
    'comment_posted',
    'comment_mention',
    'task_chat_message',
    'task_chat_mention',
    'group_message',
    'group_mention',
    'dm_message',
    'hub_mention'
  )),
  payload       jsonb not null default '{}'::jsonb,
  source_table  text,
  source_id     uuid,
  created_at    timestamptz not null default now(),
  emailed_at    timestamptz,
  -- delivered_to_bell_at: optional; bell uses localStorage dismissals today.
  -- Reserved for a future migration that moves bell off scattered fetches.
  delivered_to_bell_at timestamptz
);

create index if not exists idx_notif_outbox_pending_email
  on public.notification_outbox(recipient_id, created_at) where emailed_at is null;

create index if not exists idx_notif_outbox_recipient_recent
  on public.notification_outbox(recipient_id, created_at desc);

-- RLS: caller can SELECT their own rows; service role writes via triggers.
alter table public.notification_outbox enable row level security;

drop policy if exists "notif_outbox_select_self" on public.notification_outbox;
create policy "notif_outbox_select_self"
  on public.notification_outbox for select
  using (recipient_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies — only triggers + service-role can write.
-- Realtime so the bell can react to new entries instantly.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'notification_outbox'
  ) then
    alter publication supabase_realtime add table public.notification_outbox;
  end if;
end $$;

-- ── Trigger: enqueue on new task assignment ─────────────────
create or replace function public.enqueue_task_assignment_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.tasks%rowtype;
  assigner_name text;
begin
  select * into t from public.tasks where id = new.task_id;
  if t is null then return new; end if;
  -- Skip self-assignments (assigner == assignee).
  if t.assigned_by = new.profile_id then return new; end if;

  select full_name into assigner_name from public.profiles where id = t.assigned_by;

  insert into public.notification_outbox
    (recipient_id, event_type, payload, source_table, source_id)
  values
    (new.profile_id, 'task_assigned',
     jsonb_build_object(
       'actor_id',     t.assigned_by,
       'actor_name',   coalesce(assigner_name, 'Someone'),
       'task_id',      t.id,
       'task_title',   t.title,
       'urgency',      t.urgency,
       'is_primary',   new.is_primary
     ),
     'task_assignees', new.task_id);
  return new;
end;
$$;

drop trigger if exists trg_enqueue_task_assignment on public.task_assignees;
create trigger trg_enqueue_task_assignment
  after insert on public.task_assignees
  for each row execute function public.enqueue_task_assignment_notification();

-- ── Trigger: enqueue on new comment ─────────────────────────
-- For each task assignee + the assigner (excluding the comment author),
-- write a comment_posted row. For each mentioned_id (excluding the
-- author), also write a comment_mention row. Mentioned users get BOTH
-- so the bell shows them as a mention (priority).
create or replace function public.enqueue_comment_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.tasks%rowtype;
  author_name text;
  watcher_id uuid;
  mention_id uuid;
begin
  select * into t from public.tasks where id = new.task_id;
  if t is null then return new; end if;
  select full_name into author_name from public.profiles where id = new.author_id;

  -- Comment-posted rows for all watchers (assignee, secondary assignees, assigner)
  -- minus the author.
  for watcher_id in
    select distinct profile_id from (
      select t.assigned_by as profile_id
      union
      select t.assigned_to as profile_id
      union
      select profile_id from public.task_assignees where task_id = new.task_id
    ) w
    where profile_id is not null and profile_id <> new.author_id
  loop
    insert into public.notification_outbox
      (recipient_id, event_type, payload, source_table, source_id)
    values
      (watcher_id, 'comment_posted',
       jsonb_build_object(
         'actor_id',   new.author_id,
         'actor_name', coalesce(author_name, 'Someone'),
         'task_id',    t.id,
         'task_title', t.title,
         'snippet',    left(coalesce(new.content, ''), 140)
       ),
       'comments', new.id);
  end loop;

  -- Mention rows for each mentioned profile (excluding the author).
  if new.mentioned_ids is not null and array_length(new.mentioned_ids, 1) > 0 then
    foreach mention_id in array new.mentioned_ids loop
      if mention_id <> new.author_id then
        insert into public.notification_outbox
          (recipient_id, event_type, payload, source_table, source_id)
        values
          (mention_id, 'comment_mention',
           jsonb_build_object(
             'actor_id',   new.author_id,
             'actor_name', coalesce(author_name, 'Someone'),
             'task_id',    t.id,
             'task_title', t.title,
             'snippet',    left(coalesce(new.content, ''), 140)
           ),
           'comments', new.id);
      end if;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_comment_notification on public.comments;
create trigger trg_enqueue_comment_notification
  after insert on public.comments
  for each row execute function public.enqueue_comment_notification();

-- ── Trigger: enqueue on hub_mention insert ──────────────────
-- hub_mentions already has its own per-event email function; we ALSO
-- enqueue an outbox row so the digest aggregator can collapse them.
-- The existing hub-mention-notify edge function will be modified later
-- to skip-if-online; the outbox row is the bell + digest source of truth.
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
       'entity_id',    new.entity_id
     ),
     'hub_mentions', new.id);
  return new;
end;
$$;

drop trigger if exists trg_enqueue_hub_mention_notification on public.hub_mentions;
create trigger trg_enqueue_hub_mention_notification
  after insert on public.hub_mentions
  for each row execute function public.enqueue_hub_mention_notification();

-- ── Trigger: enqueue on dm_messages insert ──────────────────
-- For each conversation participant (excluding the author), write a row.
-- The kind of conversation determines the event_type:
--   • kind='dm' (1:1)         → 'dm_message'
--   • kind='group'            → 'group_message' (or 'group_mention' if mentioned)
--   • kind='task'             → 'task_chat_message' (or 'task_chat_mention' if mentioned)
--
-- The existing dm-offline-notify cron stays as-is for now (it sends instant
-- DMs after a 3-min unread window). The new digest function will pick up
-- these outbox rows for OFFLINE users, bundling everything.
create or replace function public.enqueue_dm_message_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  conv public.conversations%rowtype;
  author_name text;
  participant_id uuid;
  is_mentioned boolean;
  event_type_val text;
  task_title_val text;
begin
  select * into conv from public.conversations where id = new.conversation_id;
  if conv is null then return new; end if;
  if new.deleted_at is not null then return new; end if;

  select full_name into author_name from public.profiles where id = new.author_id;

  -- Resolve task title for kind='task' conversations (used in payload).
  if conv.kind = 'task' and conv.task_id is not null then
    select title into task_title_val from public.tasks where id = conv.task_id;
  end if;

  for participant_id in
    select user_id from public.conversation_participants where conversation_id = new.conversation_id
  loop
    if participant_id = new.author_id then continue; end if;

    -- Was this participant @mentioned? new.mentions is jsonb of {user_id, display_name}.
    is_mentioned := false;
    if new.mentions is not null and jsonb_typeof(new.mentions) = 'array' then
      is_mentioned := exists (
        select 1 from jsonb_array_elements(new.mentions) m
         where (m->>'user_id')::uuid = participant_id
      );
    end if;

    -- Event-type selector.
    if conv.kind = 'task' then
      event_type_val := case when is_mentioned then 'task_chat_mention' else 'task_chat_message' end;
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
         'group_title',       conv.title,
         'snippet',           left(coalesce(new.content, ''), 140),
         'is_mention',        is_mentioned
       ),
       'dm_messages', new.id);
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_dm_message_notification on public.dm_messages;
create trigger trg_enqueue_dm_message_notification
  after insert on public.dm_messages
  for each row execute function public.enqueue_dm_message_notification();
