-- ─────────────────────────────────────────────
-- 022 · Hub To-Dos
-- Named to-do lists with checkable items,
-- multi-assignee, comments, and activity trigger
-- ─────────────────────────────────────────────


-- ── To-Do Lists ──

create table public.hub_todo_lists (
  id          uuid primary key default gen_random_uuid(),
  hub_id      uuid not null references public.hubs(id) on delete cascade,
  created_by  uuid not null references public.profiles(id),
  title       text not null,
  description text,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_hub_todo_lists_hub on public.hub_todo_lists(hub_id);
create index idx_hub_todo_lists_position on public.hub_todo_lists(hub_id, position);

alter table public.hub_todo_lists enable row level security;


-- ── To-Do Items ──

create table public.hub_todo_items (
  id            uuid primary key default gen_random_uuid(),
  list_id       uuid not null references public.hub_todo_lists(id) on delete cascade,
  hub_id        uuid not null references public.hubs(id) on delete cascade,
  created_by    uuid not null references public.profiles(id),
  title         text not null,
  notes         text,
  mentions      jsonb default '[]'::jsonb,
  inline_images jsonb default '[]'::jsonb,
  completed     boolean not null default false,
  completed_at  timestamptz,
  completed_by  uuid references public.profiles(id),
  due_date      date,
  position      integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_hub_todo_items_list on public.hub_todo_items(list_id);
create index idx_hub_todo_items_hub on public.hub_todo_items(hub_id);
create index idx_hub_todo_items_position on public.hub_todo_items(list_id, position);
create index idx_hub_todo_items_due on public.hub_todo_items(due_date) where due_date is not null;

alter table public.hub_todo_items enable row level security;


-- ── To-Do Item Assignees ──

create table public.hub_todo_item_assignees (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.hub_todo_items(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (item_id, profile_id)
);

create index idx_hub_todo_assignees_item on public.hub_todo_item_assignees(item_id);
create index idx_hub_todo_assignees_profile on public.hub_todo_item_assignees(profile_id);

alter table public.hub_todo_item_assignees enable row level security;


-- ── To-Do Comments ──

create table public.hub_todo_comments (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.hub_todo_items(id) on delete cascade,
  hub_id        uuid not null references public.hubs(id) on delete cascade,
  created_by    uuid not null references public.profiles(id),
  content       text not null,
  mentions      jsonb default '[]'::jsonb,
  inline_images jsonb default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

create index idx_hub_todo_comments_item on public.hub_todo_comments(item_id);
create index idx_hub_todo_comments_hub on public.hub_todo_comments(hub_id);

alter table public.hub_todo_comments enable row level security;


-- ─────────────────────────────────────────────
-- updated_at auto-trigger (lists + items)
-- ─────────────────────────────────────────────

create or replace function public.hub_todo_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_hub_todo_lists_updated
  before update on public.hub_todo_lists
  for each row execute function public.hub_todo_set_updated_at();

create trigger trg_hub_todo_items_updated
  before update on public.hub_todo_items
  for each row execute function public.hub_todo_set_updated_at();


-- ─────────────────────────────────────────────
-- RLS Policies: hub_todo_lists
-- ─────────────────────────────────────────────

create policy "hub_todo_lists_select" on public.hub_todo_lists for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_lists.hub_id and hm.profile_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_todo_lists_insert" on public.hub_todo_lists for insert with check (
  created_by = auth.uid()
  and exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_lists.hub_id and hm.profile_id = auth.uid())
);

create policy "hub_todo_lists_update" on public.hub_todo_lists for update using (
  created_by = auth.uid()
  or exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_lists.hub_id and hm.profile_id = auth.uid() and hm.role in ('owner', 'admin'))
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_todo_lists_delete" on public.hub_todo_lists for delete using (
  created_by = auth.uid()
  or exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_lists.hub_id and hm.profile_id = auth.uid() and hm.role in ('owner', 'admin'))
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);


-- ─────────────────────────────────────────────
-- RLS Policies: hub_todo_items
-- ─────────────────────────────────────────────

create policy "hub_todo_items_select" on public.hub_todo_items for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_items.hub_id and hm.profile_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_todo_items_insert" on public.hub_todo_items for insert with check (
  created_by = auth.uid()
  and exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_items.hub_id and hm.profile_id = auth.uid())
);

create policy "hub_todo_items_update" on public.hub_todo_items for update using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_items.hub_id and hm.profile_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_todo_items_delete" on public.hub_todo_items for delete using (
  created_by = auth.uid()
  or exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_items.hub_id and hm.profile_id = auth.uid() and hm.role in ('owner', 'admin'))
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);


-- ─────────────────────────────────────────────
-- RLS Policies: hub_todo_item_assignees
-- ─────────────────────────────────────────────

create policy "hub_todo_assignees_select" on public.hub_todo_item_assignees for select using (
  exists (
    select 1 from public.hub_todo_items i
    join public.hub_members hm on hm.hub_id = i.hub_id
    where i.id = hub_todo_item_assignees.item_id and hm.profile_id = auth.uid()
  )
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_todo_assignees_insert" on public.hub_todo_item_assignees for insert with check (
  exists (
    select 1 from public.hub_todo_items i
    join public.hub_members hm on hm.hub_id = i.hub_id
    where i.id = hub_todo_item_assignees.item_id and hm.profile_id = auth.uid()
  )
);

create policy "hub_todo_assignees_delete" on public.hub_todo_item_assignees for delete using (
  exists (
    select 1 from public.hub_todo_items i
    where i.id = hub_todo_item_assignees.item_id and i.created_by = auth.uid()
  )
  or exists (
    select 1 from public.hub_todo_items i
    join public.hub_members hm on hm.hub_id = i.hub_id
    where i.id = hub_todo_item_assignees.item_id
    and hm.profile_id = auth.uid() and hm.role in ('owner', 'admin')
  )
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);


-- ─────────────────────────────────────────────
-- RLS Policies: hub_todo_comments
-- ─────────────────────────────────────────────

create policy "hub_todo_comments_select" on public.hub_todo_comments for select using (
  exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_comments.hub_id and hm.profile_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);

create policy "hub_todo_comments_insert" on public.hub_todo_comments for insert with check (
  created_by = auth.uid()
  and exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_comments.hub_id and hm.profile_id = auth.uid())
);

create policy "hub_todo_comments_delete" on public.hub_todo_comments for delete using (
  created_by = auth.uid()
  or exists (select 1 from public.hub_members hm where hm.hub_id = hub_todo_comments.hub_id and hm.profile_id = auth.uid() and hm.role in ('owner', 'admin'))
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
);


-- ─────────────────────────────────────────────
-- Activity trigger
-- ─────────────────────────────────────────────

create or replace function public.hub_activity_on_todo()
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
    'todo_added', 'todo', new.id,
    coalesce(actor_name, 'Someone') || ' added a to-do: ' || left(new.title, 80)
  );
  return new;
end;
$$;

create trigger trg_hub_activity_todo
  after insert on public.hub_todo_items
  for each row execute function public.hub_activity_on_todo();


-- ─────────────────────────────────────────────
-- Realtime
-- ─────────────────────────────────────────────

alter publication supabase_realtime add table public.hub_todo_lists;
alter publication supabase_realtime add table public.hub_todo_items;
alter publication supabase_realtime add table public.hub_todo_item_assignees;
alter publication supabase_realtime add table public.hub_todo_comments;
