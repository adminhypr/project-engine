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
  if conv_id is not null and new.assigned_by is not null then
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
--    Checks the caller can SELECT the parent task (delegates to task
--    RLS) then upserts the caller into conversation_participants.
-- ─────────────────────────────────────────────
create or replace function public.ensure_task_chat_participant(tid uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller  uuid := auth.uid();
  conv_id uuid;
  can_see boolean;
begin
  if caller is null then raise exception 'not authenticated'; end if;

  -- Caller must be able to read the parent task via task RLS. Run the
  -- visibility check as the caller (security invoker equivalent) by
  -- explicitly joining the task into a visible-tasks query.
  select true into can_see
    from public.tasks t
   where t.id = tid
     and (
       -- anyone who can see the task per existing RLS: assignee, assigner,
       -- in task_assignees, or admin/manager of the team. Mirror the
       -- predicates from migration 011's task SELECT policy.
       t.assigned_to = caller
       or t.assigned_by = caller
       or exists (select 1 from public.task_assignees ta
                   where ta.task_id = t.id and ta.profile_id = caller)
       or exists (select 1 from public.profiles p
                   where p.id = caller
                     and (p.role = 'Admin'
                          or exists (select 1 from public.profile_teams pt
                                      where pt.profile_id = caller
                                        and pt.team_id = t.team_id
                                        and pt.role in ('Manager','TeamLeader'))))
     );

  if not coalesce(can_see, false) then
    raise exception 'cannot view task %', tid;
  end if;

  select id into conv_id from public.conversations
   where kind='task' and task_id = tid;

  if conv_id is null then
    raise exception 'task chat not found for task %', tid;
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
