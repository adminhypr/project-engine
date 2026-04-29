-- ─────────────────────────────────────────────
-- 069 · Card Table module — Basecamp-style kanban
--
-- New entity (NOT an extension of tasks). Cards live in a hub, inside a
-- Card Table module, organised by named columns. They reuse the existing
-- comments + notification pipeline polymorphically:
--   • comments.card_id (nullable; CHECK exactly-one-not-null vs task_id)
--   • notification_outbox.event_type extended with card_* values
-- They do NOT participate in tasks workflows: no escalation, no My Tasks,
-- no task-side email pipeline.
-- ─────────────────────────────────────────────

-- 1. Extend hub_modules.kind to include card-table

alter table public.hub_modules
  drop constraint if exists hub_modules_kind_check;

alter table public.hub_modules
  add constraint hub_modules_kind_check check (kind in (
    'message-board','attendance-room','campfire','docs-files','to-dos','card-table'
  ));

-- 2. hub_card_columns — named columns within a Card Table module

create table public.hub_card_columns (
  id          uuid primary key default gen_random_uuid(),
  module_id   uuid not null references public.hub_modules(id) on delete cascade,
  name        text not null,
  color       text not null default '#64748b',
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);

create index idx_hub_card_columns_module on public.hub_card_columns(module_id, position);
alter table public.hub_card_columns enable row level security;

drop policy if exists "hub_card_columns_select_member" on public.hub_card_columns;
create policy "hub_card_columns_select_member" on public.hub_card_columns
  for select using (
    exists (
      select 1 from public.hub_modules hm
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where hm.id = hub_card_columns.module_id and hmem.profile_id = auth.uid()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  );

drop policy if exists "hub_card_columns_modify_owner" on public.hub_card_columns;
create policy "hub_card_columns_modify_owner" on public.hub_card_columns
  for all
  using (
    exists (
      select 1 from public.hub_modules hm
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where hm.id = hub_card_columns.module_id
        and hmem.profile_id = auth.uid()
        and hmem.role in ('owner','admin')
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  )
  with check (
    exists (
      select 1 from public.hub_modules hm
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where hm.id = hub_card_columns.module_id
        and hmem.profile_id = auth.uid()
        and hmem.role in ('owner','admin')
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  );

alter publication supabase_realtime add table public.hub_card_columns;

-- 3. hub_cards — the card itself

create table public.hub_cards (
  id          uuid primary key default gen_random_uuid(),
  module_id   uuid not null references public.hub_modules(id) on delete cascade,
  column_id   uuid not null references public.hub_card_columns(id) on delete restrict,
  title       text not null,
  notes       text,
  due_date    date,
  position    int  not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_hub_cards_column   on public.hub_cards(column_id, position);
create index idx_hub_cards_module   on public.hub_cards(module_id);

create or replace function public.bump_hub_card_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_hub_cards_updated_at on public.hub_cards;
create trigger trg_hub_cards_updated_at
  before update on public.hub_cards
  for each row execute function public.bump_hub_card_updated_at();

alter table public.hub_cards enable row level security;

-- Hub members of the card's hub can read; global Admins always can.
drop policy if exists "hub_cards_select_member" on public.hub_cards;
create policy "hub_cards_select_member" on public.hub_cards
  for select using (
    exists (
      select 1 from public.hub_modules hm
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where hm.id = hub_cards.module_id and hmem.profile_id = auth.uid()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  );

-- Any hub member can create / edit / delete cards (collaborative kanban).
-- If you want stricter (owner/admin-only writes), narrow the role list.
drop policy if exists "hub_cards_modify_member" on public.hub_cards;
create policy "hub_cards_modify_member" on public.hub_cards
  for all
  using (
    exists (
      select 1 from public.hub_modules hm
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where hm.id = hub_cards.module_id and hmem.profile_id = auth.uid()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  )
  with check (
    exists (
      select 1 from public.hub_modules hm
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where hm.id = hub_cards.module_id and hmem.profile_id = auth.uid()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  );

alter publication supabase_realtime add table public.hub_cards;

-- 4. hub_card_assignees — multi-assignee junction

create table public.hub_card_assignees (
  card_id     uuid not null references public.hub_cards(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (card_id, profile_id)
);

create index idx_hub_card_assignees_profile on public.hub_card_assignees(profile_id);

alter table public.hub_card_assignees enable row level security;

drop policy if exists "hub_card_assignees_select_member" on public.hub_card_assignees;
create policy "hub_card_assignees_select_member" on public.hub_card_assignees
  for select using (
    exists (
      select 1 from public.hub_cards c
      join public.hub_modules hm on hm.id = c.module_id
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where c.id = hub_card_assignees.card_id and hmem.profile_id = auth.uid()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  );

drop policy if exists "hub_card_assignees_modify_member" on public.hub_card_assignees;
create policy "hub_card_assignees_modify_member" on public.hub_card_assignees
  for all
  using (
    exists (
      select 1 from public.hub_cards c
      join public.hub_modules hm on hm.id = c.module_id
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where c.id = hub_card_assignees.card_id and hmem.profile_id = auth.uid()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  )
  with check (
    exists (
      select 1 from public.hub_cards c
      join public.hub_modules hm on hm.id = c.module_id
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where c.id = hub_card_assignees.card_id and hmem.profile_id = auth.uid()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  );

alter publication supabase_realtime add table public.hub_card_assignees;

-- 5. hub_card_steps — sub-checklist inside a card

create table public.hub_card_steps (
  id            uuid primary key default gen_random_uuid(),
  card_id       uuid not null references public.hub_cards(id) on delete cascade,
  label         text not null,
  position      int  not null default 0,
  completed_at  timestamptz,
  completed_by  uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index idx_hub_card_steps_card on public.hub_card_steps(card_id, position);
alter table public.hub_card_steps enable row level security;

drop policy if exists "hub_card_steps_select_member" on public.hub_card_steps;
create policy "hub_card_steps_select_member" on public.hub_card_steps
  for select using (
    exists (
      select 1 from public.hub_cards c
      join public.hub_modules hm on hm.id = c.module_id
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where c.id = hub_card_steps.card_id and hmem.profile_id = auth.uid()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  );

drop policy if exists "hub_card_steps_modify_member" on public.hub_card_steps;
create policy "hub_card_steps_modify_member" on public.hub_card_steps
  for all
  using (
    exists (
      select 1 from public.hub_cards c
      join public.hub_modules hm on hm.id = c.module_id
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where c.id = hub_card_steps.card_id and hmem.profile_id = auth.uid()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  )
  with check (
    exists (
      select 1 from public.hub_cards c
      join public.hub_modules hm on hm.id = c.module_id
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where c.id = hub_card_steps.card_id and hmem.profile_id = auth.uid()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  );

alter publication supabase_realtime add table public.hub_card_steps;

-- 6. hub_card_audit_log — column moves, assignee changes, due-date changes

create table public.hub_card_audit_log (
  id           uuid primary key default gen_random_uuid(),
  card_id      uuid not null references public.hub_cards(id) on delete cascade,
  event_type   text not null,
  performed_by uuid references public.profiles(id) on delete set null,
  old_value    text,
  new_value    text,
  note         text,
  created_at   timestamptz not null default now()
);

create index idx_hub_card_audit_card on public.hub_card_audit_log(card_id, created_at);
alter table public.hub_card_audit_log enable row level security;

-- Read-only for card viewers; service-role / triggers write.
drop policy if exists "hub_card_audit_select_member" on public.hub_card_audit_log;
create policy "hub_card_audit_select_member" on public.hub_card_audit_log
  for select using (
    exists (
      select 1 from public.hub_cards c
      join public.hub_modules hm on hm.id = c.module_id
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where c.id = hub_card_audit_log.card_id and hmem.profile_id = auth.uid()
    )
    or exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
  );

-- 7. Audit trigger: log column moves on UPDATE of hub_cards.column_id

create or replace function public.audit_hub_card_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  old_col_name text; new_col_name text;
begin
  if tg_op = 'INSERT' then
    insert into public.hub_card_audit_log (card_id, event_type, performed_by, new_value, note)
    values (new.id, 'card_created', coalesce(caller, new.created_by), null,
            'Card "' || left(new.title, 80) || '" created');
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.column_id is distinct from old.column_id then
      select name into old_col_name from public.hub_card_columns where id = old.column_id;
      select name into new_col_name from public.hub_card_columns where id = new.column_id;
      insert into public.hub_card_audit_log (card_id, event_type, performed_by, old_value, new_value, note)
      values (new.id, 'card_moved', caller, old_col_name, new_col_name,
              'Moved to ' || coalesce(new_col_name, '?'));
    end if;

    if new.due_date is distinct from old.due_date then
      insert into public.hub_card_audit_log (card_id, event_type, performed_by, old_value, new_value)
      values (new.id, 'due_date_changed', caller,
              old.due_date::text, new.due_date::text);
    end if;

    if new.title is distinct from old.title then
      insert into public.hub_card_audit_log (card_id, event_type, performed_by, old_value, new_value)
      values (new.id, 'title_changed', caller, old.title, new.title);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_audit_hub_card_change on public.hub_cards;
create trigger trg_audit_hub_card_change
  after insert or update on public.hub_cards
  for each row execute function public.audit_hub_card_change();

create or replace function public.audit_hub_card_assignee_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  who_name text;
begin
  if tg_op = 'INSERT' then
    select full_name into who_name from public.profiles where id = new.profile_id;
    insert into public.hub_card_audit_log (card_id, event_type, performed_by, new_value, note)
    values (new.card_id, 'assignee_added', caller, new.profile_id::text,
            'Assigned ' || coalesce(who_name, 'a member'));
  elsif tg_op = 'DELETE' then
    select full_name into who_name from public.profiles where id = old.profile_id;
    insert into public.hub_card_audit_log (card_id, event_type, performed_by, old_value, note)
    values (old.card_id, 'assignee_removed', caller, old.profile_id::text,
            'Unassigned ' || coalesce(who_name, 'a member'));
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_audit_hub_card_assignee_change on public.hub_card_assignees;
create trigger trg_audit_hub_card_assignee_change
  after insert or delete on public.hub_card_assignees
  for each row execute function public.audit_hub_card_assignee_change();

-- 8. Extend comments table polymorphically

alter table public.comments
  add column if not exists card_id uuid references public.hub_cards(id) on delete cascade;

create index if not exists idx_comments_card_id on public.comments(card_id) where card_id is not null;

-- Drop NOT NULL on task_id + add CHECK exactly-one-of (task_id, card_id) is set.
alter table public.comments alter column task_id drop not null;

alter table public.comments
  drop constraint if exists comments_target_check;
alter table public.comments
  add  constraint comments_target_check
    check ((task_id is null) <> (card_id is null));

-- Comments RLS: existing policies cover task comments. Add card-comment
-- access scoped to hub membership.
drop policy if exists "comments_select_card_member" on public.comments;
create policy "comments_select_card_member" on public.comments
  for select using (
    card_id is not null and exists (
      select 1 from public.hub_cards c
      join public.hub_modules hm on hm.id = c.module_id
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where c.id = comments.card_id and hmem.profile_id = auth.uid()
    )
  );

drop policy if exists "comments_insert_card_member" on public.comments;
create policy "comments_insert_card_member" on public.comments
  for insert with check (
    card_id is not null
    and author_id = auth.uid()
    and exists (
      select 1 from public.hub_cards c
      join public.hub_modules hm on hm.id = c.module_id
      join public.hub_members hmem on hmem.hub_id = hm.hub_id
      where c.id = comments.card_id and hmem.profile_id = auth.uid()
    )
  );

-- 9. Extend notification_outbox.event_type with card_* values

alter table public.notification_outbox
  drop constraint if exists notification_outbox_event_type_check;

alter table public.notification_outbox
  add constraint notification_outbox_event_type_check
    check (event_type in (
      'task_assigned','task_completed','task_declined','task_reassigned',
      'comment_posted','comment_mention',
      'task_chat_message','task_chat_mention',
      'group_message','group_mention',
      'dm_message','hub_mention',
      'card_assigned','card_comment','card_mention'
    ));

-- 10. Trigger: card assignment notifications

create or replace function public.enqueue_card_assignment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  hub_id_v uuid;
  card_title text;
begin
  if new.profile_id = caller then return new; end if;

  select hm.hub_id, c.title into hub_id_v, card_title
    from public.hub_cards c
    join public.hub_modules hm on hm.id = c.module_id
   where c.id = new.card_id;

  insert into public.notification_outbox (recipient_id, event_type, payload, source_table, source_id)
  values (
    new.profile_id,
    'card_assigned',
    jsonb_build_object(
      'card_id',   new.card_id,
      'hub_id',    hub_id_v,
      'card_title', card_title,
      'assigner',  caller
    ),
    'hub_card_assignees',
    new.card_id
  );

  return new;
end;
$$;

drop trigger if exists trg_enqueue_card_assignment_notification on public.hub_card_assignees;
create trigger trg_enqueue_card_assignment_notification
  after insert on public.hub_card_assignees
  for each row execute function public.enqueue_card_assignment_notification();

-- 11. Trigger: card comment + mention notifications.
--     Existing 062 enqueue_comment_notification fires on EVERY comment insert.
--     Re-implement to handle BOTH task comments (existing behavior) and card
--     comments (new). Watcher set for card comments = card assignees + author
--     (skip author in fan-out). Mention set = comments.mentioned_ids.

create or replace function public.enqueue_comment_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  watcher uuid;
  mentioned uuid;
  payload_json jsonb;
begin
  -- Task comment branch (preserved from 062)
  if new.task_id is not null then
    payload_json := jsonb_build_object(
      'task_id', new.task_id,
      'comment_id', new.id,
      'preview', left(coalesce(new.content, ''), 200),
      'author', new.author_id
    );
    -- Watchers: assignee, secondary assignees, assigner — minus author
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

  -- Card comment branch (new in 069)
  if new.card_id is not null then
    payload_json := jsonb_build_object(
      'card_id', new.card_id,
      'comment_id', new.id,
      'preview', left(coalesce(new.content, ''), 200),
      'author', new.author_id
    );

    -- Card watchers = current assignees, minus author
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

-- Trigger already exists from 062 — replacing the function suffices.
