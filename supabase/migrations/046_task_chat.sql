-- ─────────────────────────────────────────────
-- 046 · Task chat — live per-task conversations
--
-- Extends conversations with kind='task' + task_id FK. AFTER INSERT
-- trigger on tasks creates the conversation; AFTER INSERT trigger on
-- task_assignees seeds each assignee as a participant. Assigner is
-- seeded at conversation-creation time. Viewers (managers/admins who
-- can read the parent task but aren't assignees) enrol on first open
-- via the ensure_task_chat_participant RPC.
--
-- Reuses every piece of DM infrastructure: dm_messages, reactions,
-- threads, quote-reply, offline email via dm-offline-notify, mark-
-- read via mark_conversation_read, typing indicators.
-- ─────────────────────────────────────────────

-- 1. Extend conversations
alter table public.conversations
  add column if not exists task_id uuid references public.tasks(id) on delete cascade;

create unique index if not exists conversations_task_uniq
  on public.conversations(task_id)
  where kind = 'task' and task_id is not null;

-- Extend the existing kind CHECK. The inline check from 027 is unnamed;
-- Postgres auto-named it conversations_kind_check.
alter table public.conversations
  drop constraint if exists conversations_kind_check;
alter table public.conversations
  add constraint conversations_kind_check
  check (kind in ('dm','group','task'));

-- ─────────────────────────────────────────────
-- 2. Trigger: create task chat conversation on task insert
-- ─────────────────────────────────────────────
create or replace function public.create_task_chat_on_task_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
begin
  insert into public.conversations (kind, task_id, title, created_by)
    values ('task', new.id, null, new.assigned_by)
    on conflict do nothing
    returning id into conv_id;

  -- conv_id is null if the insert conflicted (re-run safety). Fetch it.
  if conv_id is null then
    select id into conv_id from public.conversations
     where kind='task' and task_id = new.id;
  end if;

  -- Seed the assigner as a participant.
  -- Migration 001 declares tasks.assigned_by NOT NULL, so no nullability guard needed.
  if conv_id is not null then
    insert into public.conversation_participants (conversation_id, user_id, last_read_at)
      values (conv_id, new.assigned_by, now())
      on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_create_task_chat_on_task_insert on public.tasks;
create trigger trg_create_task_chat_on_task_insert
  after insert on public.tasks
  for each row execute function public.create_task_chat_on_task_insert();

-- ─────────────────────────────────────────────
-- 3. Trigger: seed/sync participants when task_assignees change
-- ─────────────────────────────────────────────
create or replace function public.sync_task_chat_participant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
begin
  select id into conv_id from public.conversations
   where kind='task' and task_id = new.task_id;

  if conv_id is null then return new; end if;

  insert into public.conversation_participants (conversation_id, user_id, last_read_at)
    values (conv_id, new.profile_id, now())
    on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_sync_task_chat_participant on public.task_assignees;
create trigger trg_sync_task_chat_participant
  after insert on public.task_assignees
  for each row execute function public.sync_task_chat_participant();

-- ─────────────────────────────────────────────
-- 4. RPC: first-visit enrolment for viewers
--    SECURITY INVOKER — delegates task visibility to RLS rather than
--    re-implementing it inline. The extended conversations SELECT
--    policy below lets a task-viewer see the task chat IFF they can
--    see the parent task; the new conversation_participants INSERT
--    policy lets them self-enrol under the same predicate.
-- ─────────────────────────────────────────────
create or replace function public.ensure_task_chat_participant(tid uuid)
returns uuid
language plpgsql
-- NOTE: SECURITY INVOKER (default). Delegates task visibility to RLS.
set search_path = public
as $$
declare
  caller  uuid := auth.uid();
  conv_id uuid;
begin
  if caller is null then raise exception 'not authenticated'; end if;

  -- This SELECT runs under caller's RLS. The extended conversations
  -- SELECT policy (below) lets a task-viewer see the conversation IFF
  -- they can see the parent task. So: if this query returns a row,
  -- the caller has legitimate task visibility.
  select c.id into conv_id
    from public.conversations c
   where c.kind = 'task' and c.task_id = tid;

  if conv_id is null then
    raise exception 'cannot view task chat for % (task not found or access denied)', tid;
  end if;

  insert into public.conversation_participants (conversation_id, user_id, last_read_at)
    values (conv_id, caller, now())
    on conflict do nothing;

  return conv_id;
end;
$$;

grant execute on function public.ensure_task_chat_participant(uuid) to authenticated;

-- ─────────────────────────────────────────────
-- 5. Backfill: create a conversation for every existing task + seed
--    participants from assigner + task_assignees.
-- ─────────────────────────────────────────────
insert into public.conversations (kind, task_id, title, created_by)
select 'task', t.id, null, t.assigned_by
from public.tasks t
on conflict do nothing;

-- Seed assigner participants for any conversations missing them
insert into public.conversation_participants (conversation_id, user_id, last_read_at)
select c.id, t.assigned_by, now()
from public.conversations c
join public.tasks t on t.id = c.task_id
where c.kind='task'
  and t.assigned_by is not null
on conflict do nothing;

-- Seed assignee participants from task_assignees
insert into public.conversation_participants (conversation_id, user_id, last_read_at)
select c.id, ta.profile_id, now()
from public.conversations c
join public.task_assignees ta on ta.task_id = c.task_id
where c.kind='task'
on conflict do nothing;

-- ─────────────────────────────────────────────
-- 6. Realtime publication — conversations, conversation_participants,
--    and dm_messages are already in supabase_realtime from 027/033.
--    No change needed.
-- ─────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- 7. Extend 039/040 policies to permit kind='task'.
--
-- 039 restricted externals to team-group conversations. Task chat is
-- a new category where external assignees legitimately belong
-- (assignment IS a form of invitation).
--
-- Additionally, the existing participant-only SELECT rule blocks
-- first-visit enrolment: a viewer who can see the parent task but
-- isn't yet a participant couldn't see the conversation to enrol.
-- The new kind='task' branch pivots on task SELECT RLS — the nested
-- `exists (select 1 from public.tasks ...)` runs under the caller's
-- task RLS (migration 011 + 004), which is THE authoritative task-
-- visibility check. No drift, no duplication.
-- ─────────────────────────────────────────────
drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant" on public.conversations
  for select
  using (
    (
      -- Either you're already a participant (existing rule)
      public.is_conversation_participant(id)
      -- Or the conversation is a task chat whose parent task you can read
      or (
        kind = 'task'
        and task_id is not null
        and exists (select 1 from public.tasks t where t.id = conversations.task_id)
      )
    )
    and (
      -- Non-externals: unrestricted (matches 027)
      not public.is_external_user(auth.uid())
      -- Externals: team groups (existing 039 rule) OR task chats
      or (kind = 'group' and team_id is not null)
      or kind = 'task'
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
          )
      )
    )
  );

-- 040 hardened dm_messages SELECT the same way 039 hardened INSERT.
-- Extend it symmetrically so externals can read task-chat messages
-- they're participants in.
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
          )
      )
    )
  );

-- ─────────────────────────────────────────────
-- 8. conversation_participants INSERT policy for task-chat self-enrol.
--
-- Lets the SECURITY INVOKER RPC (ensure_task_chat_participant) insert
-- the caller's own row into a task-chat conversation they can read.
-- The nested `exists` on tasks runs under the caller's task SELECT
-- RLS, so only task-viewers can self-insert into task chats.
-- ─────────────────────────────────────────────
drop policy if exists "conversation_participants_insert_self_task" on public.conversation_participants;
create policy "conversation_participants_insert_self_task" on public.conversation_participants
  for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and c.kind = 'task'
        and c.task_id is not null
        and exists (select 1 from public.tasks t where t.id = c.task_id)
    )
  );
