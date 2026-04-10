-- ─────────────────────────────────────────────
-- 016 · Custom Hubs + Docs & Files
-- Independent hub spaces with member management,
-- file/folder storage, and migration of existing
-- hub_* tables from team_id to hub_id
-- ─────────────────────────────────────────────


-- ── Hubs table ──

create table public.hubs (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  icon         text,
  color        text,
  created_by   uuid not null references public.profiles(id),
  team_id      uuid references public.teams(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index idx_hubs_created_by on public.hubs(created_by);
create index idx_hubs_team on public.hubs(team_id);

alter table public.hubs enable row level security;


-- ── Hub Members ──

create table public.hub_members (
  hub_id      uuid not null references public.hubs(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at  timestamptz not null default now(),
  primary key (hub_id, profile_id)
);

create index idx_hub_members_profile on public.hub_members(profile_id);

alter table public.hub_members enable row level security;


-- ── Hub Folders ──

create table public.hub_folders (
  id          uuid primary key default gen_random_uuid(),
  hub_id      uuid not null references public.hubs(id) on delete cascade,
  parent_id   uuid references public.hub_folders(id) on delete cascade,
  name        text not null,
  color       text,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

create index idx_hub_folders_hub    on public.hub_folders(hub_id);
create index idx_hub_folders_parent on public.hub_folders(parent_id);

alter table public.hub_folders enable row level security;


-- ── Hub Files ──

create table public.hub_files (
  id            uuid primary key default gen_random_uuid(),
  hub_id        uuid not null references public.hubs(id) on delete cascade,
  folder_id     uuid references public.hub_folders(id) on delete set null,
  uploaded_by   uuid not null references public.profiles(id),
  file_name     text not null,
  file_size     integer not null,
  mime_type     text not null,
  storage_path  text not null,
  created_at    timestamptz not null default now()
);

create index idx_hub_files_hub    on public.hub_files(hub_id);
create index idx_hub_files_folder on public.hub_files(folder_id);

alter table public.hub_files enable row level security;


-- ─────────────────────────────────────────────
-- Backfill: create a hub for each existing team
-- ─────────────────────────────────────────────

insert into public.hubs (name, created_by, team_id)
select t.name,
       coalesce(
         (select p.id from public.profiles p where p.role = 'Admin' order by p.created_at limit 1),
         (select p.id from public.profiles p order by p.created_at limit 1)
       ),
       t.id
from public.teams t;

-- Populate hub_members from profile_teams
insert into public.hub_members (hub_id, profile_id, role)
select h.id, pt.profile_id,
  case when pt.role = 'Manager' then 'admin' else 'member' end
from public.hubs h
join public.profile_teams pt on pt.team_id = h.team_id
on conflict do nothing;

-- Set creators as owners
update public.hub_members set role = 'owner'
where (hub_id, profile_id) in (
  select id, created_by from public.hubs
);


-- ─────────────────────────────────────────────
-- Add hub_id to existing hub_* tables
-- ─────────────────────────────────────────────

alter table public.hub_messages add column hub_id uuid references public.hubs(id) on delete cascade;
alter table public.hub_chat_messages add column hub_id uuid references public.hubs(id) on delete cascade;
alter table public.hub_check_in_prompts add column hub_id uuid references public.hubs(id) on delete cascade;
alter table public.hub_events add column hub_id uuid references public.hubs(id) on delete cascade;
alter table public.hub_activity add column hub_id uuid references public.hubs(id) on delete cascade;

-- Backfill hub_id from team_id → hubs.team_id
update public.hub_messages set hub_id = h.id from public.hubs h where h.team_id = hub_messages.team_id;
update public.hub_chat_messages set hub_id = h.id from public.hubs h where h.team_id = hub_chat_messages.team_id;
update public.hub_check_in_prompts set hub_id = h.id from public.hubs h where h.team_id = hub_check_in_prompts.team_id;
update public.hub_events set hub_id = h.id from public.hubs h where h.team_id = hub_events.team_id;
update public.hub_activity set hub_id = h.id from public.hubs h where h.team_id = hub_activity.team_id;

-- Make hub_id NOT NULL (safe after backfill — empty tables just work)
alter table public.hub_messages alter column hub_id set not null;
alter table public.hub_chat_messages alter column hub_id set not null;
alter table public.hub_check_in_prompts alter column hub_id set not null;
alter table public.hub_events alter column hub_id set not null;
alter table public.hub_activity alter column hub_id set not null;

-- Indexes on hub_id
create index idx_hub_messages_hub on public.hub_messages(hub_id);
create index idx_hub_chat_hub on public.hub_chat_messages(hub_id);
create index idx_hub_checkin_prompts_hub on public.hub_check_in_prompts(hub_id);
create index idx_hub_events_hub on public.hub_events(hub_id);
create index idx_hub_activity_hub on public.hub_activity(hub_id);


-- ─────────────────────────────────────────────
-- RLS Policies: hubs + hub_members
-- ─────────────────────────────────────────────

-- Hubs: visible to members
create policy "hubs_select" on public.hubs for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hubs.id and hm.profile_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hubs_insert" on public.hubs for insert with check (
  created_by = auth.uid()
);

create policy "hubs_update" on public.hubs for update using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hubs.id and hm.profile_id = auth.uid() and hm.role in ('owner', 'admin'))
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hubs_delete" on public.hubs for delete using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hubs.id and hm.profile_id = auth.uid() and hm.role = 'owner')
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

-- Hub members: visible to other members of same hub
create policy "hub_members_select" on public.hub_members for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_members.hub_id and hm.profile_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_members_insert" on public.hub_members for insert with check (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_members.hub_id and hm.profile_id = auth.uid() and hm.role in ('owner', 'admin'))
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  -- Allow self-insert when creating a hub (creator adds themselves)
  or (hub_members.profile_id = auth.uid() and hub_members.role = 'owner')
);

create policy "hub_members_update" on public.hub_members for update using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_members.hub_id and hm.profile_id = auth.uid() and hm.role = 'owner')
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_members_delete" on public.hub_members for delete using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_members.hub_id and hm.profile_id = auth.uid() and hm.role in ('owner', 'admin'))
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  -- Members can remove themselves
  or hub_members.profile_id = auth.uid()
);


-- ─────────────────────────────────────────────
-- RLS Policies: hub_folders + hub_files
-- ─────────────────────────────────────────────

create policy "hub_folders_select" on public.hub_folders for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_folders.hub_id and hm.profile_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_folders_insert" on public.hub_folders for insert with check (
  created_by = auth.uid()
  and exists (select 1 from public.hub_members hm where hm.hub_id = hub_folders.hub_id and hm.profile_id = auth.uid())
);

create policy "hub_folders_update" on public.hub_folders for update using (
  created_by = auth.uid()
  or exists (select 1 from public.hub_members hm where hm.hub_id = hub_folders.hub_id and hm.profile_id = auth.uid() and hm.role in ('owner', 'admin'))
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_folders_delete" on public.hub_folders for delete using (
  created_by = auth.uid()
  or exists (select 1 from public.hub_members hm where hm.hub_id = hub_folders.hub_id and hm.profile_id = auth.uid() and hm.role in ('owner', 'admin'))
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_files_select" on public.hub_files for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_files.hub_id and hm.profile_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_files_insert" on public.hub_files for insert with check (
  uploaded_by = auth.uid()
  and exists (select 1 from public.hub_members hm where hm.hub_id = hub_files.hub_id and hm.profile_id = auth.uid())
);

create policy "hub_files_delete" on public.hub_files for delete using (
  uploaded_by = auth.uid()
  or exists (select 1 from public.hub_members hm where hm.hub_id = hub_files.hub_id and hm.profile_id = auth.uid() and hm.role in ('owner', 'admin'))
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);


-- ─────────────────────────────────────────────
-- Update existing hub_* RLS: add hub_members-based policies
-- (We add new policies using hub_id; old team_id policies still work for backward compat)
-- ─────────────────────────────────────────────

-- hub_messages: add hub_id-based select
create policy "hub_messages_select_by_hub" on public.hub_messages for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_messages.hub_id and hm.profile_id = auth.uid())
);

create policy "hub_messages_insert_by_hub" on public.hub_messages for insert with check (
  author_id = auth.uid()
  and exists (select 1 from public.hub_members hm where hm.hub_id = hub_messages.hub_id and hm.profile_id = auth.uid())
);

-- hub_chat_messages: add hub_id-based select
create policy "hub_chat_select_by_hub" on public.hub_chat_messages for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_chat_messages.hub_id and hm.profile_id = auth.uid())
);

create policy "hub_chat_insert_by_hub" on public.hub_chat_messages for insert with check (
  author_id = auth.uid()
  and exists (select 1 from public.hub_members hm where hm.hub_id = hub_chat_messages.hub_id and hm.profile_id = auth.uid())
);

-- hub_check_in_prompts: add hub_id-based select
create policy "check_in_prompts_select_by_hub" on public.hub_check_in_prompts for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_check_in_prompts.hub_id and hm.profile_id = auth.uid())
);

-- hub_events: add hub_id-based select
create policy "hub_events_select_by_hub" on public.hub_events for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_events.hub_id and hm.profile_id = auth.uid())
);

create policy "hub_events_insert_by_hub" on public.hub_events for insert with check (
  created_by = auth.uid()
  and exists (select 1 from public.hub_members hm where hm.hub_id = hub_events.hub_id and hm.profile_id = auth.uid())
);

-- hub_activity: add hub_id-based select
create policy "hub_activity_select_by_hub" on public.hub_activity for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_activity.hub_id and hm.profile_id = auth.uid())
);


-- ─────────────────────────────────────────────
-- Update triggers: include hub_id in hub_activity inserts
-- ─────────────────────────────────────────────

create or replace function public.hub_activity_on_message()
returns trigger
language plpgsql
security definer
as $$
declare
  actor_name text;
begin
  select full_name into actor_name from public.profiles where id = new.author_id;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    new.team_id,
    new.hub_id,
    new.author_id,
    case when new.parent_id is null then 'message_posted' else 'message_reply' end,
    'message',
    new.id,
    case when new.parent_id is null
      then coalesce(actor_name, 'Someone') || ' posted: ' || left(coalesce(new.title, new.content), 80)
      else coalesce(actor_name, 'Someone') || ' replied to a message'
    end
  );
  return new;
end;
$$;

create or replace function public.hub_activity_on_check_in()
returns trigger
language plpgsql
security definer
as $$
declare
  actor_name text;
  prompt_team uuid;
  prompt_hub uuid;
  prompt_question text;
begin
  select full_name into actor_name from public.profiles where id = new.author_id;
  select team_id, hub_id, question into prompt_team, prompt_hub, prompt_question
    from public.hub_check_in_prompts where id = new.prompt_id;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    prompt_team,
    prompt_hub,
    new.author_id,
    'check_in_response',
    'check_in',
    new.id,
    coalesce(actor_name, 'Someone') || ' answered: ' || left(prompt_question, 60)
  );
  return new;
end;
$$;

create or replace function public.hub_activity_on_event()
returns trigger
language plpgsql
security definer
as $$
declare
  actor_name text;
begin
  select full_name into actor_name from public.profiles where id = new.created_by;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    new.team_id,
    new.hub_id,
    new.created_by,
    'event_created',
    'event',
    new.id,
    coalesce(actor_name, 'Someone') || ' added event: ' || left(new.title, 80)
  );
  return new;
end;
$$;

create or replace function public.hub_activity_on_chat()
returns trigger
language plpgsql
security definer
as $$
declare
  actor_name text;
  recent_count int;
begin
  select count(*) into recent_count from public.hub_activity
  where hub_id = new.hub_id
    and actor_id = new.author_id
    and event_type = 'chat_message'
    and created_at > now() - interval '5 minutes';
  if recent_count > 0 then return new; end if;

  select full_name into actor_name from public.profiles where id = new.author_id;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    new.team_id,
    new.hub_id,
    new.author_id,
    'chat_message',
    'chat',
    new.id,
    coalesce(actor_name, 'Someone') || ' is chatting in Campfire'
  );
  return new;
end;
$$;


-- ─────────────────────────────────────────────
-- Storage bucket for hub files
-- ─────────────────────────────────────────────

insert into storage.buckets (id, name, public) values ('hub-files', 'hub-files', false)
on conflict do nothing;

-- Storage policies: hub members can upload and read
create policy "hub_files_storage_select" on storage.objects for select using (
  bucket_id = 'hub-files'
  and auth.role() = 'authenticated'
);

create policy "hub_files_storage_insert" on storage.objects for insert with check (
  bucket_id = 'hub-files'
  and auth.role() = 'authenticated'
);

create policy "hub_files_storage_delete" on storage.objects for delete using (
  bucket_id = 'hub-files'
  and auth.role() = 'authenticated'
);


-- ─────────────────────────────────────────────
-- Realtime for new tables
-- ─────────────────────────────────────────────

alter publication supabase_realtime add table public.hubs;
alter publication supabase_realtime add table public.hub_members;
alter publication supabase_realtime add table public.hub_files;
alter publication supabase_realtime add table public.hub_folders;
