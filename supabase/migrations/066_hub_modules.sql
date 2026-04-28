-- ─────────────────────────────────────────────
-- 066 · Hub modules registry — Basecamp-style multi-instance modules
--
-- Promotes hub modules from hardcoded singletons to first-class entities.
-- A hub can now have multiple instances of each kind (Message Board,
-- Attendance Room, Campfire, Docs & Files, To-Dos), each with its own
-- title and grid position.
--
-- Module kinds:
--   · message-board
--   · attendance-room   (presence widget — stateless)
--   · campfire          (chat — backed by conversations(kind='hub'))
--   · docs-files
--   · to-dos
--
-- Layout: 3-column free-flow grid. Each module has (column_index, position).
--
-- Permissions: hub_members where role in ('owner','admin') manage modules.
-- ─────────────────────────────────────────────

-- 1. hub_modules table

create table public.hub_modules (
  id            uuid primary key default gen_random_uuid(),
  hub_id        uuid not null references public.hubs(id) on delete cascade,
  kind          text not null check (kind in ('message-board','attendance-room','campfire','docs-files','to-dos')),
  title         text not null,
  column_index  int  not null default 0 check (column_index between 0 and 2),
  position      int  not null default 0,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index idx_hub_modules_hub_layout on public.hub_modules(hub_id, column_index, position);
alter table public.hub_modules enable row level security;

-- All hub members can read modules; admins (global) read all.
drop policy if exists "hub_modules_select_member" on public.hub_modules;
create policy "hub_modules_select_member" on public.hub_modules
  for select
  using (
    public.is_hub_member(hub_id)
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  );

-- Hub owners/admins can manage modules; global Admins can too.
drop policy if exists "hub_modules_modify_owner" on public.hub_modules;
create policy "hub_modules_modify_owner" on public.hub_modules
  for all
  using (
    exists (
      select 1 from public.hub_members hm
      where hm.hub_id = hub_modules.hub_id
        and hm.profile_id = auth.uid()
        and hm.role in ('owner','admin')
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  )
  with check (
    exists (
      select 1 from public.hub_members hm
      where hm.hub_id = hub_modules.hub_id
        and hm.profile_id = auth.uid()
        and hm.role in ('owner','admin')
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  );

alter publication supabase_realtime add table public.hub_modules;

-- 2. Add module_id FKs to data-bearing tables

alter table public.hub_messages    add column if not exists module_id uuid references public.hub_modules(id) on delete cascade;
alter table public.hub_todo_lists  add column if not exists module_id uuid references public.hub_modules(id) on delete cascade;
alter table public.hub_folders     add column if not exists module_id uuid references public.hub_modules(id) on delete cascade;
alter table public.hub_files       add column if not exists module_id uuid references public.hub_modules(id) on delete cascade;
alter table public.conversations   add column if not exists module_id uuid references public.hub_modules(id) on delete cascade;

create index if not exists idx_hub_messages_module    on public.hub_messages(module_id)   where module_id is not null;
create index if not exists idx_hub_todo_lists_module  on public.hub_todo_lists(module_id) where module_id is not null;
create index if not exists idx_hub_folders_module     on public.hub_folders(module_id)    where module_id is not null;
create index if not exists idx_hub_files_module       on public.hub_files(module_id)      where module_id is not null;
create index if not exists idx_conversations_module   on public.conversations(module_id)  where module_id is not null;

-- 3. Backfill: create 5 default modules per existing hub + link existing rows

do $$
declare
  h record;
  mb_id uuid; df_id uuid; ar_id uuid; cf_id uuid; td_id uuid;
begin
  for h in select id from public.hubs loop
    insert into public.hub_modules (hub_id, kind, title, column_index, position)
      values (h.id, 'message-board',   'Message Board', 0, 0) returning id into mb_id;
    insert into public.hub_modules (hub_id, kind, title, column_index, position)
      values (h.id, 'docs-files',      'Docs & Files',  0, 1) returning id into df_id;
    insert into public.hub_modules (hub_id, kind, title, column_index, position)
      values (h.id, 'attendance-room', 'Who''s Here',   1, 0) returning id into ar_id;
    insert into public.hub_modules (hub_id, kind, title, column_index, position)
      values (h.id, 'campfire',        'Campfire',      2, 0) returning id into cf_id;
    insert into public.hub_modules (hub_id, kind, title, column_index, position)
      values (h.id, 'to-dos',          'To-Dos',        2, 1) returning id into td_id;

    update public.hub_messages   set module_id = mb_id where hub_id = h.id and module_id is null;
    update public.hub_todo_lists set module_id = td_id where hub_id = h.id and module_id is null;
    update public.hub_folders    set module_id = df_id where hub_id = h.id and module_id is null;
    update public.hub_files      set module_id = df_id where hub_id = h.id and module_id is null;
    update public.conversations  set module_id = cf_id where kind = 'hub' and hub_id = h.id and module_id is null;
  end loop;
end $$;

-- 4. Replace migration 064's "create hub conversation on hubs INSERT" trigger.
--    Going forward, the conversation is created when the campfire MODULE is
--    inserted (which happens via the default-modules trigger on hubs insert,
--    or when an owner adds a new Campfire module).

drop trigger if exists trg_create_hub_chat_on_hub_insert on public.hubs;

create or replace function public.create_hub_chat_on_module_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
  hcreator uuid;
begin
  if new.kind <> 'campfire' then return new; end if;

  select created_by into hcreator from public.hubs where id = new.hub_id;

  insert into public.conversations (kind, hub_id, module_id, title, created_by)
    values ('hub', new.hub_id, new.id, new.title, coalesce(hcreator, new.created_by))
    on conflict do nothing
    returning id into conv_id;

  if conv_id is null then
    select id into conv_id from public.conversations
      where kind = 'hub' and module_id = new.id;
  end if;

  -- Seed every current hub member as a participant of this new campfire.
  if conv_id is not null then
    insert into public.conversation_participants (conversation_id, user_id, last_read_at)
      select conv_id, hm.profile_id, now()
        from public.hub_members hm
       where hm.hub_id = new.hub_id
      on conflict do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_create_hub_chat_on_module_insert on public.hub_modules;
create trigger trg_create_hub_chat_on_module_insert
  after insert on public.hub_modules
  for each row execute function public.create_hub_chat_on_module_insert();

-- 5. Keep titles in sync: renaming a campfire module renames its conversation.
--    (Other module kinds have no backing conversation.)
create or replace function public.sync_hub_module_conversation_title()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'campfire' and new.title is distinct from old.title then
    update public.conversations
       set title = new.title
     where kind = 'hub' and module_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_hub_module_conversation_title on public.hub_modules;
create trigger trg_sync_hub_module_conversation_title
  after update of title, kind on public.hub_modules
  for each row execute function public.sync_hub_module_conversation_title();

-- 6. New hubs auto-include one of each kind.
create or replace function public.create_hub_default_modules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.hub_modules (hub_id, kind, title, column_index, position, created_by)
  values
    (new.id, 'message-board',   'Message Board', 0, 0, new.created_by),
    (new.id, 'docs-files',      'Docs & Files',  0, 1, new.created_by),
    (new.id, 'attendance-room', 'Who''s Here',   1, 0, new.created_by),
    (new.id, 'campfire',        'Campfire',      2, 0, new.created_by),
    (new.id, 'to-dos',          'To-Dos',        2, 1, new.created_by);
  return new;
end;
$$;

drop trigger if exists trg_create_hub_default_modules on public.hubs;
create trigger trg_create_hub_default_modules
  after insert on public.hubs
  for each row execute function public.create_hub_default_modules();

-- 7. The unique partial index from 064 was (hub_id) where kind='hub' — that
--    forced one campfire per hub. Drop it and re-key on (module_id) so each
--    campfire module gets its own conversation.

drop index if exists conversations_hub_uniq;

create unique index if not exists conversations_hub_module_uniq
  on public.conversations(module_id)
  where kind = 'hub' and module_id is not null;

-- 8. Replace 064's per-hub participant sync with one that adds/removes the
--    user from EVERY hub conversation in that hub (one per campfire module).

create or replace function public.sync_hub_chat_participant_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.conversation_participants (conversation_id, user_id, last_read_at)
    select c.id, new.profile_id, now()
      from public.conversations c
     where c.kind = 'hub' and c.hub_id = new.hub_id
    on conflict do nothing;
  return new;
end;
$$;

create or replace function public.sync_hub_chat_participant_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.conversation_participants
   where user_id = old.profile_id
     and conversation_id in (
       select id from public.conversations
        where kind = 'hub' and hub_id = old.hub_id
     );
  return old;
end;
$$;

-- 9. New RPC for the frontend: resolve a campfire module's conversation id.
--    Replaces 064's get_or_create_hub_conversation(hub_id), which assumed
--    one campfire per hub.

create or replace function public.get_hub_module_conversation(mod_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller   uuid := auth.uid();
  conv_id  uuid;
  mod_hub  uuid;
  mod_kind text;
begin
  if mod_id is null then raise exception 'module id required'; end if;

  select hub_id, kind into mod_hub, mod_kind
    from public.hub_modules where id = mod_id;
  if mod_hub is null then raise exception 'module not found'; end if;
  if mod_kind <> 'campfire' then raise exception 'module is not a campfire'; end if;

  -- Caller must be a hub member, or a global Admin.
  if caller is not null
     and not exists (select 1 from public.hub_members where hub_id = mod_hub and profile_id = caller)
     and not exists (select 1 from public.profiles where id = caller and role = 'Admin')
  then
    raise exception 'not a hub member';
  end if;

  select id into conv_id
    from public.conversations
   where kind = 'hub' and module_id = mod_id;

  return conv_id;
end;
$$;
grant execute on function public.get_hub_module_conversation(uuid) to authenticated;

-- 10. Drop 064's get_or_create_hub_conversation — superseded by
--     get_hub_module_conversation. Frontend has been updated to call the new
--     one. Old RPC removed to avoid drift.
drop function if exists public.get_or_create_hub_conversation(uuid);
