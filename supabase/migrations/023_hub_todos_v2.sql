-- ─────────────────────────────────────────────
-- 023 · Hub To-Dos v2
-- Color, soft-delete, attachments, subscribers,
-- completion + comment activity, edge-function hooks
-- ─────────────────────────────────────────────

-- ── Lists: color, deleted_at, attachments ──

alter table public.hub_todo_lists
  add column color       text not null default 'blue'
    check (color in ('blue','green','red','yellow','purple','orange','gray')),
  add column deleted_at  timestamptz,
  add column attachments jsonb not null default '[]'::jsonb;

create index idx_hub_todo_lists_active on public.hub_todo_lists(hub_id) where deleted_at is null;

-- ── Items: deleted_at, attachments ──

alter table public.hub_todo_items
  add column deleted_at  timestamptz,
  add column attachments jsonb not null default '[]'::jsonb;

create index idx_hub_todo_items_active on public.hub_todo_items(list_id) where deleted_at is null;

-- ── Subscribers table ──

create table public.hub_todo_item_subscribers (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.hub_todo_items(id) on delete cascade,
  profile_id uuid not null references public.profiles(id)       on delete cascade,
  created_at timestamptz not null default now(),
  unique (item_id, profile_id)
);

create index idx_hub_todo_subscribers_item    on public.hub_todo_item_subscribers(item_id);
create index idx_hub_todo_subscribers_profile on public.hub_todo_item_subscribers(profile_id);

alter table public.hub_todo_item_subscribers enable row level security;


-- ─────────────────────────────────────────────
-- RLS Policies: hub_todo_item_subscribers
-- ─────────────────────────────────────────────

create policy "hub_todo_subscribers_select" on public.hub_todo_item_subscribers for select using (
  exists (
    select 1 from public.hub_todo_items i
    join public.hub_members hm on hm.hub_id = i.hub_id
    where i.id = hub_todo_item_subscribers.item_id and hm.profile_id = auth.uid()
  )
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_todo_subscribers_insert" on public.hub_todo_item_subscribers for insert with check (
  exists (
    select 1 from public.hub_todo_items i
    join public.hub_members hm on hm.hub_id = i.hub_id
    where i.id = hub_todo_item_subscribers.item_id and hm.profile_id = auth.uid()
  )
);

create policy "hub_todo_subscribers_delete" on public.hub_todo_item_subscribers for delete using (
  profile_id = auth.uid()
  or exists (
    select 1 from public.hub_todo_items i
    join public.hub_members hm on hm.hub_id = i.hub_id
    where i.id = hub_todo_item_subscribers.item_id
    and hm.profile_id = auth.uid() and hm.role in ('owner', 'admin')
  )
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

alter publication supabase_realtime add table public.hub_todo_item_subscribers;


-- ─────────────────────────────────────────────
-- Auto-subscribe triggers
-- ─────────────────────────────────────────────

-- Auto-subscribe creator on item insert
create or replace function public.hub_todo_item_auto_subscribe_creator()
returns trigger language plpgsql security definer as $$
begin
  insert into public.hub_todo_item_subscribers (item_id, profile_id)
  values (new.id, new.created_by)
  on conflict (item_id, profile_id) do nothing;
  return new;
end;
$$;

create trigger trg_hub_todo_item_subscribe_creator
  after insert on public.hub_todo_items
  for each row execute function public.hub_todo_item_auto_subscribe_creator();

-- Auto-subscribe assignee when added
create or replace function public.hub_todo_assignee_auto_subscribe()
returns trigger language plpgsql security definer as $$
begin
  insert into public.hub_todo_item_subscribers (item_id, profile_id)
  values (new.item_id, new.profile_id)
  on conflict (item_id, profile_id) do nothing;
  return new;
end;
$$;

create trigger trg_hub_todo_assignee_subscribe
  after insert on public.hub_todo_item_assignees
  for each row execute function public.hub_todo_assignee_auto_subscribe();

-- Auto-subscribe commenter on comment insert
create or replace function public.hub_todo_comment_auto_subscribe()
returns trigger language plpgsql security definer as $$
begin
  insert into public.hub_todo_item_subscribers (item_id, profile_id)
  values (new.item_id, new.created_by)
  on conflict (item_id, profile_id) do nothing;
  return new;
end;
$$;

create trigger trg_hub_todo_comment_subscribe
  after insert on public.hub_todo_comments
  for each row execute function public.hub_todo_comment_auto_subscribe();


-- ─────────────────────────────────────────────
-- Activity-feed triggers
-- ─────────────────────────────────────────────

-- Activity: item completed (false → true transition only)
create or replace function public.hub_activity_on_todo_completed()
returns trigger language plpgsql security definer as $$
declare
  actor_name text;
  hub_team uuid;
begin
  if (old.completed = false and new.completed = true) then
    select full_name into actor_name from public.profiles where id = new.completed_by;
    select team_id into hub_team from public.hubs where id = new.hub_id;
    insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
    values (
      hub_team, new.hub_id, new.completed_by,
      'todo_item_completed', 'todo', new.id,
      coalesce(actor_name, 'Someone') || ' completed a to-do: ' || left(new.title, 80)
    );
  end if;
  return new;
end;
$$;

create trigger trg_hub_activity_todo_completed
  after update on public.hub_todo_items
  for each row
  when (old.completed is distinct from new.completed)
  execute function public.hub_activity_on_todo_completed();

-- Activity: list created
create or replace function public.hub_activity_on_todo_list_created()
returns trigger language plpgsql security definer as $$
declare
  actor_name text;
  hub_team uuid;
begin
  select full_name into actor_name from public.profiles where id = new.created_by;
  select team_id into hub_team from public.hubs where id = new.hub_id;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    hub_team, new.hub_id, new.created_by,
    'todo_list_created', 'todo_list', new.id,
    coalesce(actor_name, 'Someone') || ' started a list: ' || left(new.title, 80)
  );
  return new;
end;
$$;

create trigger trg_hub_activity_todo_list_created
  after insert on public.hub_todo_lists
  for each row execute function public.hub_activity_on_todo_list_created();

-- Activity: item assigned
create or replace function public.hub_activity_on_todo_assigned()
returns trigger language plpgsql security definer as $$
declare
  assigner_name text;
  assignee_name text;
  item_title text;
  hub_id_v uuid;
  hub_team uuid;
begin
  select title, hub_id into item_title, hub_id_v from public.hub_todo_items where id = new.item_id;
  select full_name into assigner_name from public.profiles where id = auth.uid();
  select full_name into assignee_name from public.profiles where id = new.profile_id;
  select team_id into hub_team from public.hubs where id = hub_id_v;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    hub_team, hub_id_v, auth.uid(),
    'todo_item_assigned', 'todo', new.item_id,
    coalesce(assigner_name, 'Someone') || ' assigned ' || coalesce(assignee_name, 'someone') ||
      ' to ' || left(coalesce(item_title, 'a to-do'), 60)
  );
  return new;
end;
$$;

create trigger trg_hub_activity_todo_assigned
  after insert on public.hub_todo_item_assignees
  for each row execute function public.hub_activity_on_todo_assigned();


-- ─────────────────────────────────────────────
-- Backfill subscribers for existing items
-- ─────────────────────────────────────────────

-- Backfill: creators
insert into public.hub_todo_item_subscribers (item_id, profile_id)
  select id, created_by from public.hub_todo_items
  on conflict (item_id, profile_id) do nothing;

-- Backfill: assignees
insert into public.hub_todo_item_subscribers (item_id, profile_id)
  select item_id, profile_id from public.hub_todo_item_assignees
  on conflict (item_id, profile_id) do nothing;


-- ─────────────────────────────────────────────
-- Update SELECT RLS to hide soft-deleted rows
-- ─────────────────────────────────────────────

drop policy "hub_todo_lists_select" on public.hub_todo_lists;
create policy "hub_todo_lists_select" on public.hub_todo_lists for select using (
  deleted_at is null and (
    exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_lists.hub_id and hm.profile_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  )
);

drop policy "hub_todo_items_select" on public.hub_todo_items;
create policy "hub_todo_items_select" on public.hub_todo_items for select using (
  deleted_at is null and (
    exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_items.hub_id and hm.profile_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  )
);
