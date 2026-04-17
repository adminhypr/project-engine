-- supabase/migrations/027_direct_messages.sql
-- 1:1 (and future group) direct messaging.

------------------------------------------------------------
-- Tables
------------------------------------------------------------
create table if not exists public.conversations (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null default 'dm' check (kind in ('dm','group')),
  title                text,
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  last_message_at      timestamptz not null default now(),
  last_message_preview text
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  joined_at       timestamptz not null default now(),
  last_read_at    timestamptz not null default 'epoch',
  muted           boolean not null default false,
  primary key (conversation_id, user_id)
);
create index if not exists conversation_participants_user_idx
  on public.conversation_participants(user_id);

create table if not exists public.dm_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_id       uuid not null references public.profiles(id) on delete cascade,
  kind            text not null default 'user' check (kind in ('user','system')),
  content         text,
  mentions        jsonb not null default '[]'::jsonb,
  inline_images   jsonb not null default '[]'::jsonb,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists dm_messages_conversation_created_idx
  on public.dm_messages(conversation_id, created_at desc);

------------------------------------------------------------
-- Helper: am I a participant in this conversation?
-- SECURITY DEFINER to break RLS recursion between tables.
------------------------------------------------------------
create or replace function public.is_conversation_participant(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = cid and user_id = auth.uid()
  );
$$;
grant execute on function public.is_conversation_participant(uuid) to authenticated;

------------------------------------------------------------
-- RLS
------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.dm_messages enable row level security;

-- conversations
drop policy if exists "conversations_select_participant" on public.conversations;
create policy "conversations_select_participant" on public.conversations
  for select using (public.is_conversation_participant(id));

drop policy if exists "conversations_update_participant" on public.conversations;
create policy "conversations_update_participant" on public.conversations
  for update using (public.is_conversation_participant(id));
-- No INSERT or DELETE policy: default-deny. Created exclusively via RPC.

-- conversation_participants
drop policy if exists "conv_participants_select" on public.conversation_participants;
create policy "conv_participants_select" on public.conversation_participants
  for select using (
    user_id = auth.uid() or public.is_conversation_participant(conversation_id)
  );

drop policy if exists "conv_participants_update_own" on public.conversation_participants;
create policy "conv_participants_update_own" on public.conversation_participants
  for update using (user_id = auth.uid());
-- No INSERT or DELETE policy: default-deny. Created exclusively via RPC.

-- dm_messages
drop policy if exists "dm_messages_select_participant" on public.dm_messages;
create policy "dm_messages_select_participant" on public.dm_messages
  for select using (public.is_conversation_participant(conversation_id));

drop policy if exists "dm_messages_insert_participant" on public.dm_messages;
create policy "dm_messages_insert_participant" on public.dm_messages
  for insert with check (
    public.is_conversation_participant(conversation_id)
    and author_id = auth.uid()
  );

drop policy if exists "dm_messages_update_author" on public.dm_messages;
create policy "dm_messages_update_author" on public.dm_messages
  for update using (author_id = auth.uid());
-- No DELETE policy: soft-delete only via UPDATE.

------------------------------------------------------------
-- RPC: atomic get-or-create 1:1 between current user and other
------------------------------------------------------------
create or replace function public.get_or_create_dm(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing uuid;
  new_id uuid;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  if other_user_id is null or other_user_id = me then
    raise exception 'invalid other user';
  end if;

  select c.id into existing
  from public.conversations c
  where c.kind = 'dm'
    and exists (select 1 from public.conversation_participants cp
                 where cp.conversation_id = c.id and cp.user_id = me)
    and exists (select 1 from public.conversation_participants cp
                 where cp.conversation_id = c.id and cp.user_id = other_user_id)
    and (select count(*) from public.conversation_participants cp
          where cp.conversation_id = c.id) = 2
  limit 1;

  if existing is not null then
    return existing;
  end if;

  insert into public.conversations (kind, created_by)
    values ('dm', me) returning id into new_id;
  insert into public.conversation_participants (conversation_id, user_id)
    values (new_id, me), (new_id, other_user_id);
  return new_id;
end;
$$;
grant execute on function public.get_or_create_dm(uuid) to authenticated;

------------------------------------------------------------
-- RPC: mark conversation read
------------------------------------------------------------
create or replace function public.mark_conversation_read(cid uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversation_participants
    set last_read_at = now()
    where conversation_id = cid and user_id = auth.uid();
end;
$$;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

------------------------------------------------------------
-- Trigger: bump conversation.last_message_at + preview on message insert
------------------------------------------------------------
create or replace function public.bump_conversation_last_message()
returns trigger
language plpgsql
as $$
begin
  update public.conversations
    set last_message_at      = new.created_at,
        last_message_preview = left(coalesce(new.content, ''), 140)
    where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists dm_messages_bump_last on public.dm_messages;
create trigger dm_messages_bump_last
  after insert on public.dm_messages
  for each row execute function public.bump_conversation_last_message();

------------------------------------------------------------
-- Realtime publication
------------------------------------------------------------
alter publication supabase_realtime add table public.dm_messages;
alter publication supabase_realtime add table public.conversations;

------------------------------------------------------------
-- Storage bucket for DM inline images
------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('dm-attachments', 'dm-attachments', false, 5242880)
on conflict (id) do nothing;

-- Storage RLS: only participants in the referenced conversation can read/write.
-- Object paths are namespaced as: {conversation_id}/{message_id or uuid}/{filename}
drop policy if exists "dm_attachments_read_participant" on storage.objects;
create policy "dm_attachments_read_participant" on storage.objects
  for select using (
    bucket_id = 'dm-attachments'
    and public.is_conversation_participant(
      (storage.foldername(name))[1]::uuid
    )
  );

drop policy if exists "dm_attachments_insert_participant" on storage.objects;
create policy "dm_attachments_insert_participant" on storage.objects
  for insert with check (
    bucket_id = 'dm-attachments'
    and public.is_conversation_participant(
      (storage.foldername(name))[1]::uuid
    )
  );
