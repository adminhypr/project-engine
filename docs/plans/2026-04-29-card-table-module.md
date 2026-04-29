# Card Table Module Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Basecamp-style "Card Table" hub module with named columns, drag-reorderable cards, multi-assignees, due dates, rich-text notes, sub-steps, and a comment thread — without touching the existing `tasks` workflow, escalation engine, or My Tasks surface.

**Architecture:** Cards are a NEW entity (`hub_cards` + `hub_card_columns`), not an extension of `tasks`. To avoid duplicating the comment / mention / email-digest pipeline, we extend the existing `comments` table polymorphically (`task_id` OR `card_id`, exactly-one-not-null), and the existing `notification_outbox.event_type` CHECK to include card events. Audit lives in its own `hub_card_audit_log` to keep the task audit log clean. The Card Table is one of the `kind` values in `hub_modules`; users can have multiple Card Table modules per hub. The per-user module layout work (migration 068) covers reordering the Card Table module itself within the hub grid — the columns inside it are a global "house" layout.

**Tech Stack:** Supabase (Postgres + RLS + Realtime), React 18 + Vite, Tailwind, Framer Motion, `@dnd-kit/core` + `/sortable` (already in deps), TipTap-based `RichInput` (already in repo), Vitest for pure-helper tests.

**Migrations:** This feature ships migrations **069** (initial schema), **070** (post-execution fixes), and **071** (`get_card_comment_counts` RPC — PostgREST aggregates are disabled on this Supabase project, so per-card comment counts go through a SECURITY INVOKER RPC instead).

**Open assumptions** (flag at start of execution if any are wrong):
- Cards have a `due_date` (visible in Basecamp screenshots).
- Cards do **not** have a separate `completed_at` — the "Done" column IS the completion signal. `hub_card_steps` items have their own per-step `completed_at`. (If the team wants both, this is a small Task 1 schema delta — add `completed_at` + `completed_by` to `hub_cards`.)
- Card comments do NOT support reactions in v1 (current task comments don't either). Skipped.
- Card-level "boost" reactions skipped in v1. Future task.
- Externals (Agent / Client roles) follow the same hub-invite gate as today — they see Card Tables only in hubs they've been added to. No extra RLS.

**Deferred to v2:**
- Reactions on card comments
- Per-card "boost" emoji
- Drag-reorder of columns (v1 ships fixed ordering by `position` set at create time; admin can rename, can't reorder via DnD yet)
- "Move along to →" quick-action on the card detail header (v1 uses a regular column `<select>`)

---

## Task 1: Migration 069 — Card Table schema

**Files:**
- Create: `supabase/migrations/069_hub_card_table.sql`

**Step 1: Write the migration**

Create `supabase/migrations/069_hub_card_table.sql` with this content:

```sql
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
```

**Step 2: Apply the migration to cloud staging**

Run from repo root:

```bash
PAT=$(grep ^SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) && \
  BODY=$(jq -Rs '{query: .}' < supabase/migrations/069_hub_card_table.sql) && \
  curl -s -X POST "https://api.supabase.com/v1/projects/urdzocyfxgyhqmoqbuvk/database/query" \
    -H "Authorization: Bearer $PAT" \
    -H "Content-Type: application/json" \
    -d "$BODY"
```

Expected output: `[]` (empty array on DDL success).

**Step 3: Verify in cloud**

```bash
PAT=$(grep ^SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) && \
  curl -s -X POST "https://api.supabase.com/v1/projects/urdzocyfxgyhqmoqbuvk/database/query" \
    -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" \
    -d '{"query": "select count(*) from public.hub_card_columns"}'
```

Expected: `[{"count": 0}]`.

**Step 4: Commit**

```bash
git add supabase/migrations/069_hub_card_table.sql
git commit -m "feat(card-table): migration 069 — schema for Card Table module"
```

---

## Task 2: Pure helpers + tests for card grouping/sorting

**Files:**
- Create: `src/lib/cards.js`
- Test: `src/lib/__tests__/cards.test.js`

**Step 1: Write the failing test**

Create `src/lib/__tests__/cards.test.js`:

```javascript
import { describe, it, expect } from 'vitest'
import { groupCardsByColumn, sortCards } from '../cards'

describe('sortCards', () => {
  it('sorts by position ascending, id breaks ties', () => {
    const arr = [
      { id: 'b', position: 1 },
      { id: 'a', position: 1 },
      { id: 'c', position: 0 },
    ]
    expect(sortCards(arr).map(x => x.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('groupCardsByColumn', () => {
  it('groups by column_id, preserves per-column position order', () => {
    const cards = [
      { id: 'c1', column_id: 'col-a', position: 1 },
      { id: 'c2', column_id: 'col-b', position: 0 },
      { id: 'c3', column_id: 'col-a', position: 0 },
    ]
    const result = groupCardsByColumn(cards, ['col-a', 'col-b'])
    expect(result['col-a'].map(c => c.id)).toEqual(['c3', 'c1'])
    expect(result['col-b'].map(c => c.id)).toEqual(['c2'])
  })

  it('returns empty array for columns with no cards', () => {
    const result = groupCardsByColumn([], ['col-a'])
    expect(result['col-a']).toEqual([])
  })
})
```

**Step 2: Run test (expected to fail)**

```bash
npx vitest run src/lib/__tests__/cards.test.js
```

Expected: FAIL with "Cannot find module '../cards'".

**Step 3: Write the helper**

Create `src/lib/cards.js`:

```javascript
// Pure helpers for card grouping/sorting. Mirrors the shape of
// hub_modules helpers in src/hooks/useHubModules.js but column ids are
// dynamic (one per hub_card_columns row), not the fixed three-column
// constant from the module grid.

export function sortCards(arr) {
  arr.sort((a, b) =>
    ((a.position ?? 0) - (b.position ?? 0)) ||
    a.id.localeCompare(b.id)
  )
  return arr
}

export function groupCardsByColumn(cards, columnIds) {
  const out = {}
  for (const id of columnIds) out[id] = []
  for (const c of cards) {
    if (out[c.column_id]) out[c.column_id].push(c)
  }
  for (const id of columnIds) sortCards(out[id])
  return out
}
```

**Step 4: Run tests**

```bash
npx vitest run src/lib/__tests__/cards.test.js
```

Expected: PASS, 3/3 tests.

**Step 5: Commit**

```bash
git add src/lib/cards.js src/lib/__tests__/cards.test.js
git commit -m "feat(card-table): cards grouping/sorting helpers + tests"
```

---

## Task 3: `useHubCardColumns` hook

**Files:**
- Create: `src/hooks/useHubCardColumns.js`

**Step 1: Implement the hook**

Mirror the shape of `useHubModules`. Realtime + CRUD for columns scoped to one Card Table module.

Create `src/hooks/useHubCardColumns.js`:

```javascript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

const DEFAULT_COLORS = ['#64748b', '#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899']

export function useHubCardColumns(moduleId) {
  const { profile } = useAuth()
  const [columns, setColumns] = useState([])
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const [loading, setLoading] = useState(true)
  const moduleRef = useRef(moduleId)
  moduleRef.current = moduleId

  const fetch = useCallback(async () => {
    if (!moduleRef.current) return
    const { data, error } = await supabase
      .from('hub_card_columns')
      .select('*')
      .eq('module_id', moduleRef.current)
      .order('position')
    if (error) { console.warn('hub_card_columns fetch failed:', error.message); setLoading(false); return }
    setColumns(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!moduleId) { setColumns([]); setLoading(false); return }
    setLoading(true)
    fetch()
  }, [moduleId, fetch])

  useEffect(() => {
    if (!moduleId) return
    const ch = supabase.channel(`hub-card-cols-${moduleId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_card_columns', filter: `module_id=eq.${moduleId}` },
        () => fetch()
      ).subscribe()
    return () => supabase.removeChannel(ch)
  }, [moduleId, fetch])

  const addColumn = useCallback(async (name) => {
    const trimmed = (name || '').trim()
    if (!trimmed || !moduleRef.current || !profile?.id) return null
    // Read columns from ref so this callback's identity doesn't churn on
    // every realtime tick (each fetch produces a new array reference).
    const cur = columnsRef.current
    const nextPos = cur.length
      ? Math.max(...cur.map(c => c.position ?? 0)) + 1
      : 0
    const color = DEFAULT_COLORS[cur.length % DEFAULT_COLORS.length]
    const { data, error } = await supabase
      .from('hub_card_columns')
      .insert({ module_id: moduleRef.current, name: trimmed, color, position: nextPos })
      .select().single()
    if (error) { showToast(error.message || 'Failed to add column', 'error'); return null }
    return data
  }, [profile?.id])

  const renameColumn = useCallback(async (columnId, name) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return false
    const { error } = await supabase.from('hub_card_columns').update({ name: trimmed }).eq('id', columnId)
    if (error) { showToast(error.message || 'Failed to rename column', 'error'); return false }
    return true
  }, [])

  const setColumnColor = useCallback(async (columnId, color) => {
    const { error } = await supabase.from('hub_card_columns').update({ color }).eq('id', columnId)
    if (error) { showToast(error.message || 'Failed to update color', 'error'); return false }
    return true
  }, [])

  const deleteColumn = useCallback(async (columnId) => {
    // FK on hub_cards.column_id is ON DELETE RESTRICT — UI must move/delete
    // cards first. This call surfaces the FK error if cards exist.
    const { error } = await supabase.from('hub_card_columns').delete().eq('id', columnId)
    if (error) { showToast(error.message || 'Move or delete the cards in this column first.', 'error'); return false }
    return true
  }, [])

  return { columns, loading, addColumn, renameColumn, setColumnColor, deleteColumn, refetch: fetch }
}
```

**Step 2: Sanity check — build**

```bash
npm run build
```

Expected: clean build (no import errors).

**Step 3: Commit**

```bash
git add src/hooks/useHubCardColumns.js
git commit -m "feat(card-table): useHubCardColumns hook"
```

---

## Task 4: `useHubCards` hook

**Files:**
- Create: `src/hooks/useHubCards.js`

**Step 1: Implement the hook**

Reads cards (with assignees + comment count) for a module. CRUD: add, update, move, delete. Multi-assign / unassign. Realtime-driven refetches.

Create `src/hooks/useHubCards.js`:

```javascript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'
import { sortCards } from '../lib/cards'

const CARD_SELECT = `
  *,
  assignees:hub_card_assignees(profile:profiles(id, full_name, avatar_url))
`

export function useHubCards(moduleId) {
  const { profile } = useAuth()
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const moduleRef = useRef(moduleId)
  moduleRef.current = moduleId
  const cardsRef = useRef(cards)
  cardsRef.current = cards

  const fetch = useCallback(async () => {
    if (!moduleRef.current) return
    const [cardsRes, countsRes] = await Promise.all([
      supabase.from('hub_cards').select(CARD_SELECT).eq('module_id', moduleRef.current),
      // Per-card comment counts via SECURITY INVOKER RPC (migration 071).
      // PostgREST aggregates are disabled on this Supabase project, and a
      // per-card HEAD-count loop would be N+1 — RPC is the cheap path.
      supabase.rpc('get_card_comment_counts', { p_module_id: moduleRef.current }),
    ])
    if (cardsRes.error) { console.warn('hub_cards fetch failed:', cardsRes.error.message); setLoading(false); return }

    const countMap = new Map()
    if (countsRes.error) {
      console.warn('get_card_comment_counts failed:', countsRes.error.message)
    } else if (countsRes.data) {
      for (const r of countsRes.data) countMap.set(r.card_id, Number(r.comment_count) || 0)
    }

    const enriched = (cardsRes.data || []).map(c => ({
      ...c,
      assignees: (c.assignees || []).map(a => a.profile).filter(Boolean),
      comment_count: countMap.get(c.id) || 0,
    }))
    setCards(sortCards(enriched))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!moduleId) { setCards([]); setLoading(false); return }
    setLoading(true)
    fetch()
  }, [moduleId, fetch])

  // Realtime: any change to hub_cards or hub_card_assignees in this module
  // triggers a refetch. (The full refetch is acceptable because card lists
  // are small per module — Basecamp boards rarely exceed ~100 cards.)
  useEffect(() => {
    if (!moduleId) return
    const ch = supabase.channel(`hub-cards-${moduleId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_cards', filter: `module_id=eq.${moduleId}` },
        () => fetch()
      )
      .on('postgres_changes',
        // No filter on hub_card_assignees (no direct module_id column).
        { event: '*', schema: 'public', table: 'hub_card_assignees' },
        (payload) => {
          // Only refetch if the affected card belongs to this module.
          const cardId = payload.new?.card_id || payload.old?.card_id
          if (cardId && cardsRef.current.some(c => c.id === cardId)) fetch()
        }
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [moduleId, fetch])

  const addCard = useCallback(async ({ columnId, title, dueDate = null }) => {
    if (!moduleRef.current || !profile?.id) return null
    const trimmed = (title || '').trim()
    if (!trimmed) return null
    const colCards = cardsRef.current.filter(c => c.column_id === columnId)
    const nextPos = colCards.length
      ? Math.max(...colCards.map(c => c.position ?? 0)) + 1
      : 0
    const { data, error } = await supabase.from('hub_cards').insert({
      module_id: moduleRef.current,
      column_id: columnId,
      title: trimmed,
      due_date: dueDate,
      position: nextPos,
      created_by: profile.id,
    }).select().single()
    if (error) { showToast(error.message || 'Failed to add card', 'error'); return null }
    return data
  }, [profile?.id])

  const updateCard = useCallback(async (cardId, patch) => {
    const { error } = await supabase.from('hub_cards').update(patch).eq('id', cardId)
    if (error) { showToast(error.message || 'Failed to save card', 'error'); return false }
    return true
  }, [])

  const moveCard = useCallback(async (cardId, { columnId, position }) => {
    // Optimistic: shift the card locally so the UI reflects the drop
    // immediately instead of waiting for the realtime roundtrip.
    setCards(prev => {
      const next = prev.map(c =>
        c.id === cardId ? { ...c, column_id: columnId, position } : c
      )
      return sortCards(next)
    })
    const { error } = await supabase.from('hub_cards')
      .update({ column_id: columnId, position })
      .eq('id', cardId)
    if (error) {
      showToast(error.message || 'Failed to move card', 'error')
      fetch() // revert to authoritative state
      return false
    }
    return true
  }, [fetch])

  const deleteCard = useCallback(async (cardId) => {
    const { error } = await supabase.from('hub_cards').delete().eq('id', cardId)
    if (error) { showToast(error.message || 'Failed to delete card', 'error'); return false }
    return true
  }, [])

  const assignCard = useCallback(async (cardId, profileIds) => {
    if (!profileIds?.length) return
    const rows = profileIds.map(pid => ({ card_id: cardId, profile_id: pid }))
    const { error } = await supabase.from('hub_card_assignees').upsert(rows, { onConflict: 'card_id,profile_id' })
    if (error) { showToast(error.message || 'Failed to assign', 'error'); return false }
    return true
  }, [])

  const unassignCard = useCallback(async (cardId, profileId) => {
    const { error } = await supabase.from('hub_card_assignees')
      .delete().eq('card_id', cardId).eq('profile_id', profileId)
    if (error) { showToast(error.message || 'Failed to unassign', 'error'); return false }
    return true
  }, [])

  return {
    cards,
    loading,
    addCard, updateCard, moveCard, deleteCard,
    assignCard, unassignCard,
    refetch: fetch,
  }
}
```

**Step 2: Sanity build**

```bash
npm run build
```

Expected: clean.

**Step 3: Commit**

```bash
git add src/hooks/useHubCards.js
git commit -m "feat(card-table): useHubCards hook with realtime + CRUD"
```

---

## Task 5: `useHubCardSteps` hook

**Files:**
- Create: `src/hooks/useHubCardSteps.js`

**Step 1: Implement the hook**

Modeled on `useHubTodoItems`. Add / toggle / delete / reorder per card.

Create `src/hooks/useHubCardSteps.js`:

```javascript
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

export function useHubCardSteps(cardId) {
  const { profile } = useAuth()
  const [steps, setSteps] = useState([])
  const stepsRef = useRef(steps)
  stepsRef.current = steps
  const [loading, setLoading] = useState(true)
  const cardRef = useRef(cardId)
  cardRef.current = cardId

  const fetch = useCallback(async () => {
    if (!cardRef.current) return
    const { data, error } = await supabase
      .from('hub_card_steps')
      .select('*')
      .eq('card_id', cardRef.current)
      .order('position')
    if (error) { console.warn('hub_card_steps fetch failed:', error.message); setLoading(false); return }
    setSteps(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!cardId) { setSteps([]); setLoading(false); return }
    setLoading(true)
    fetch()
  }, [cardId, fetch])

  useEffect(() => {
    if (!cardId) return
    const ch = supabase.channel(`hub-card-steps-${cardId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_card_steps', filter: `card_id=eq.${cardId}` },
        () => fetch()
      ).subscribe()
    return () => supabase.removeChannel(ch)
  }, [cardId, fetch])

  const addStep = useCallback(async (label) => {
    const trimmed = (label || '').trim()
    if (!trimmed || !cardRef.current) return null
    // Read steps from ref so this callback's identity doesn't churn on
    // every realtime tick (each fetch produces a new array reference).
    const cur = stepsRef.current
    const nextPos = cur.length ? Math.max(...cur.map(s => s.position ?? 0)) + 1 : 0
    const { data, error } = await supabase.from('hub_card_steps').insert({
      card_id: cardRef.current, label: trimmed, position: nextPos,
    }).select().single()
    if (error) { showToast(error.message || 'Failed to add step', 'error'); return null }
    return data
  }, [])

  const toggleStep = useCallback(async (stepId, completed) => {
    const patch = completed
      ? { completed_at: new Date().toISOString(), completed_by: profile?.id ?? null }
      : { completed_at: null, completed_by: null }
    const { error } = await supabase.from('hub_card_steps').update(patch).eq('id', stepId)
    if (error) { showToast(error.message || 'Failed to update step', 'error'); return false }
    return true
  }, [profile?.id])

  const deleteStep = useCallback(async (stepId) => {
    const { error } = await supabase.from('hub_card_steps').delete().eq('id', stepId)
    if (error) { showToast(error.message || 'Failed to delete step', 'error'); return false }
    return true
  }, [])

  return { steps, loading, addStep, toggleStep, deleteStep, refetch: fetch }
}
```

**Step 2: Build**

```bash
npm run build
```

**Step 3: Commit**

```bash
git add src/hooks/useHubCardSteps.js
git commit -m "feat(card-table): useHubCardSteps hook"
```

---

## Task 6: `CardTable` module component (kanban grid)

**Files:**
- Create: `src/components/hub/cards/CardTable.jsx`
- Create: `src/components/hub/cards/CardColumn.jsx`
- Create: `src/components/hub/cards/CardPreview.jsx`
- Create: `src/components/hub/cards/AddColumnInline.jsx`

**Step 1: Build `CardPreview.jsx`** (the small card on the board)

Create `src/components/hub/cards/CardPreview.jsx`:

```jsx
import { MessageSquare, CalendarDays } from 'lucide-react'
import { format, parseISO } from 'date-fns'

export default function CardPreview({ card, onClick }) {
  const due = card.due_date ? parseISO(card.due_date) : null
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left p-3 rounded-xl bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border hover:border-brand-300 dark:hover:border-brand-500 shadow-card transition-colors"
    >
      <div className="text-sm font-medium text-slate-900 dark:text-white line-clamp-2">{card.title}</div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1.5 min-w-0">
          {due && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={11} />
              {format(due, 'MMM d')}
            </span>
          )}
          {card.comment_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare size={11} />
              {card.comment_count}
            </span>
          )}
        </div>
        <div className="flex -space-x-1.5 shrink-0">
          {(card.assignees || []).slice(0, 3).map(a => (
            <div
              key={a.id}
              title={a.full_name}
              className="w-5 h-5 rounded-full ring-2 ring-white dark:ring-dark-card bg-slate-200 dark:bg-slate-700 overflow-hidden"
            >
              {a.avatar_url
                ? <img src={a.avatar_url} alt="" className="w-full h-full object-cover" />
                : <span className="block text-[9px] font-bold text-slate-600 dark:text-slate-300 leading-5 text-center">{a.full_name?.[0] || '?'}</span>}
            </div>
          ))}
          {card.assignees?.length > 3 && (
            <div className="w-5 h-5 rounded-full ring-2 ring-white dark:ring-dark-card bg-slate-100 dark:bg-slate-800 text-[9px] font-semibold text-slate-500 leading-5 text-center">
              +{card.assignees.length - 3}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
```

**Step 2: Build `CardColumn.jsx`** (one column with sortable cards + add-card affordance)

Create `src/components/hub/cards/CardColumn.jsx`:

```jsx
import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import CardPreview from './CardPreview'

function SortableCardPreview({ card, onClick }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardPreview card={card} onClick={onClick} />
    </div>
  )
}

export default function CardColumn({
  column, cards, canManage,
  onOpenCard, onAddCard, onRenameColumn, onDeleteColumn,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` })
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(column.name)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const cardIds = cards.map(c => c.id)

  return (
    <div ref={setNodeRef} className={`flex flex-col min-w-[260px] w-[260px] rounded-2xl bg-slate-50 dark:bg-dark-bg/40 p-2 border ${isOver ? 'border-brand-300 dark:border-brand-500' : 'border-transparent'}`}>
      <div className="flex items-center justify-between gap-1 px-2 py-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: column.color }} />
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { onRenameColumn(column.id, draft); setRenaming(false) }
                if (e.key === 'Escape') { setDraft(column.name); setRenaming(false) }
              }}
              onBlur={() => { onRenameColumn(column.id, draft); setRenaming(false) }}
              className="form-input text-sm font-bold py-0 px-1 min-w-0 flex-1"
            />
          ) : (
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{column.name}</span>
          )}
          <span className="text-xs text-slate-400">{cards.length}</span>
        </div>
        {canManage && !renaming && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button type="button" onClick={() => setRenaming(true)} className="p-1 rounded text-slate-400 hover:text-brand-500" title="Rename"><Pencil size={12} /></button>
            <button type="button" onClick={() => onDeleteColumn(column)} className="p-1 rounded text-slate-400 hover:text-red-500" title="Delete column"><Trash2 size={12} /></button>
          </div>
        )}
      </div>

      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-2 px-1 pb-1 min-h-[40px]">
          {cards.map(c => (
            <SortableCardPreview key={c.id} card={c} onClick={() => onOpenCard(c.id)} />
          ))}
        </div>
      </SortableContext>

      {adding ? (
        <div className="px-1">
          <input
            autoFocus
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && newTitle.trim()) {
                await onAddCard(column.id, newTitle.trim())
                setNewTitle('')
                setAdding(false)
              }
              if (e.key === 'Escape') { setNewTitle(''); setAdding(false) }
            }}
            onBlur={() => { setNewTitle(''); setAdding(false) }}
            placeholder="Card title"
            className="form-input text-sm w-full"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1 mx-1 flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-500 hover:text-brand-500 hover:bg-white dark:hover:bg-dark-card rounded-lg transition-colors"
        >
          <Plus size={12} />
          Add a card
        </button>
      )}
    </div>
  )
}
```

**Step 3: Build `AddColumnInline.jsx`** (admin-only "+ Add column" button on far right)

Create `src/components/hub/cards/AddColumnInline.jsx`:

```jsx
import { useState } from 'react'
import { Plus } from 'lucide-react'

export default function AddColumnInline({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="self-start flex items-center gap-1.5 px-3 py-2 text-xs text-slate-500 hover:text-brand-500 hover:bg-white dark:hover:bg-dark-card rounded-xl transition-colors min-w-[180px]">
        <Plus size={12} /> Add column
      </button>
    )
  }
  return (
    <div className="self-start min-w-[220px]">
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === 'Enter' && name.trim()) {
            await onAdd(name.trim())
            setName(''); setOpen(false)
          }
          if (e.key === 'Escape') { setName(''); setOpen(false) }
        }}
        onBlur={() => { setName(''); setOpen(false) }}
        placeholder="Column name"
        className="form-input text-sm w-full"
      />
    </div>
  )
}
```

**Step 4: Build `CardTable.jsx`** (the module entry — replaces the inline `<Comp>` rendered by HubModuleCard)

Create `src/components/hub/cards/CardTable.jsx`:

```jsx
import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  DndContext, closestCorners, pointerWithin, rectIntersection,
  PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { useHubCardColumns } from '../../../hooks/useHubCardColumns'
import { useHubCards } from '../../../hooks/useHubCards'
import { useHubs } from '../../../hooks/useHubs'
import { useAuth } from '../../../hooks/useAuth'
import { groupCardsByColumn } from '../../../lib/cards'
import { showToast } from '../../ui/index'
import CardColumn from './CardColumn'
import AddColumnInline from './AddColumnInline'

function collisionDetection(args) {
  const ptr = pointerWithin(args)
  if (ptr.length) return ptr
  const inter = rectIntersection(args)
  if (inter.length) return inter
  return closestCorners(args)
}

export default function CardTable({ hubId, moduleId }) {
  const { isAdmin } = useAuth()
  const { hubs } = useHubs()
  const hub = hubs.find(h => h.id === hubId)
  const myRole = hub?.my_role || 'member'
  const canManage = isAdmin || myRole === 'owner' || myRole === 'admin'

  const { columns, loading: colsLoading, addColumn, renameColumn, deleteColumn } = useHubCardColumns(moduleId)
  const { cards, loading: cardsLoading, addCard, moveCard } = useHubCards(moduleId)
  const [, setSearchParams] = useSearchParams()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  const grouped = useMemo(() => groupCardsByColumn(cards, columns.map(c => c.id)), [cards, columns])

  function findColumnFor(id) {
    if (typeof id === 'string' && id.startsWith('col:')) return id.slice(4)
    const card = cards.find(c => c.id === id)
    return card?.column_id || null
  }

  async function handleDragEnd(event) {
    const { active, over } = event
    if (!over) return
    const fromColId = findColumnFor(active.id)
    const toColId   = findColumnFor(over.id)
    if (!fromColId || !toColId) return

    const targetColCards = grouped[toColId] || []
    let toIndex = targetColCards.length
    if (over.id !== `col:${toColId}`) {
      const idx = targetColCards.findIndex(c => c.id === over.id)
      if (idx !== -1) toIndex = idx
    }
    // Position = the position the card should occupy. Other cards shift
    // down naturally on next refetch since position is recomputed there.
    await moveCard(active.id, { columnId: toColId, position: toIndex })
  }

  function openCard(cardId) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('card', cardId)
      return next
    })
  }

  if (colsLoading || cardsLoading) {
    return <div className="p-4 text-sm text-slate-400">Loading cards…</div>
  }

  if (columns.length === 0) {
    return (
      <div className="p-4 text-sm text-slate-500 dark:text-slate-400">
        {canManage
          ? <>No columns yet. <button onClick={() => addColumn('To do')} className="text-brand-500 hover:underline">Add the first column</button>.</>
          : <>This Card Table has no columns yet.</>}
      </div>
    )
  }

  return (
    <div className="px-3 py-3">
      <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2 group">
          {columns.map(col => (
            <CardColumn
              key={col.id}
              column={col}
              cards={grouped[col.id] || []}
              canManage={canManage}
              onOpenCard={openCard}
              onAddCard={async (colId, title) => {
                const created = await addCard({ columnId: colId, title })
                if (created) showToast('Card added')
              }}
              onRenameColumn={renameColumn}
              onDeleteColumn={async (c) => {
                if (!confirm(`Delete column "${c.name}"? Cards must be moved or deleted first.`)) return
                await deleteColumn(c.id)
              }}
            />
          ))}
          {canManage && <AddColumnInline onAdd={addColumn} />}
        </div>
      </DndContext>
    </div>
  )
}
```

**Step 5: Sanity build**

```bash
npm run build
```

Expected: clean build.

**Step 6: Commit**

```bash
git add src/components/hub/cards/
git commit -m "feat(card-table): grid + columns + DnD + add-card UI"
```

---

## Task 7: `CardDetailPanel` (slide-in)

**Files:**
- Create: `src/components/hub/cards/CardDetailPanel.jsx`
- Create: `src/components/hub/cards/CardSteps.jsx`
- Create: `src/components/hub/cards/CardComments.jsx`

**Step 1: Build `CardSteps.jsx`** (the sub-checklist inside the detail panel)

Create `src/components/hub/cards/CardSteps.jsx`:

```jsx
import { useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { useHubCardSteps } from '../../../hooks/useHubCardSteps'

export default function CardSteps({ cardId }) {
  const { steps, addStep, toggleStep, deleteStep } = useHubCardSteps(cardId)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-1">
      {steps.map(s => (
        <div key={s.id} className="flex items-center gap-2 group">
          <button
            type="button"
            onClick={() => toggleStep(s.id, !s.completed_at)}
            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${s.completed_at ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}
            aria-label={s.completed_at ? 'Mark incomplete' : 'Mark complete'}
          >
            {s.completed_at && <Check size={11} />}
          </button>
          <span className={`text-sm flex-1 ${s.completed_at ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
            {s.label}
          </span>
          <button type="button" onClick={() => deleteStep(s.id)}
            className="p-0.5 rounded text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100" aria-label="Delete step">
            <X size={12} />
          </button>
        </div>
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={async e => {
            if (e.key === 'Enter' && draft.trim()) { await addStep(draft.trim()); setDraft(''); setAdding(false) }
            if (e.key === 'Escape') { setDraft(''); setAdding(false) }
          }}
          onBlur={() => { setDraft(''); setAdding(false) }}
          placeholder="Add a step…"
          className="form-input text-sm w-full"
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-brand-500 mt-1">
          <Plus size={12} /> Add step
        </button>
      )}
    </div>
  )
}
```

**Step 2: Build `CardComments.jsx`** (reuse RichInput; uses `comments` table polymorphically)

Create `src/components/hub/cards/CardComments.jsx`:

```jsx
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../hooks/useAuth'
import RichInput from '../../ui/RichInput'
import RichContentRenderer from '../../ui/RichContentRenderer'
import { format, parseISO } from 'date-fns'

export default function CardComments({ cardId }) {
  const { profile } = useAuth()
  const [comments, setComments] = useState([])
  const [draft, setDraft] = useState('')
  const [mentionedIds, setMentionedIds] = useState([])
  const [posting, setPosting] = useState(false)

  const fetch = useCallback(async () => {
    const { data, error } = await supabase
      .from('comments')
      .select('id, content, created_at, mentioned_ids, author:profiles!comments_author_id_fkey(id, full_name, avatar_url)')
      .eq('card_id', cardId)
      .order('created_at', { ascending: true })
    if (!error) setComments(data || [])
  }, [cardId])

  useEffect(() => { fetch() }, [fetch])

  useEffect(() => {
    const ch = supabase.channel(`card-comments-${cardId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'comments', filter: `card_id=eq.${cardId}` },
        () => fetch()
      ).subscribe()
    return () => supabase.removeChannel(ch)
  }, [cardId, fetch])

  async function post() {
    if (!draft.trim() || !profile?.id) return
    setPosting(true)
    const { error } = await supabase.from('comments').insert({
      card_id: cardId,
      author_id: profile.id,
      content: draft,
      mentioned_ids: mentionedIds,
    })
    setPosting(false)
    if (!error) { setDraft(''); setMentionedIds([]) }
  }

  return (
    <div className="space-y-3">
      {comments.map(c => (
        <div key={c.id} className="flex gap-2">
          <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden shrink-0">
            {c.author?.avatar_url
              ? <img src={c.author.avatar_url} alt="" className="w-full h-full object-cover" />
              : <span className="block text-[10px] font-bold text-slate-600 leading-7 text-center">{c.author?.full_name?.[0] || '?'}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-slate-900 dark:text-white">{c.author?.full_name}</span>
              <span className="text-xs text-slate-400">{format(parseISO(c.created_at), 'MMM d, h:mm a')}</span>
            </div>
            <div className="text-sm text-slate-700 dark:text-slate-200 mt-0.5">
              <RichContentRenderer content={c.content} />
            </div>
          </div>
        </div>
      ))}
      <div className="pt-2 border-t border-slate-100 dark:border-dark-border">
        <RichInput
          value={draft}
          onChange={setDraft}
          onMentionsChange={setMentionedIds}
          placeholder="Write a comment…"
        />
        <div className="mt-2 flex justify-end">
          <button onClick={post} disabled={posting || !draft.trim()}
            className="btn btn-primary text-sm px-4 disabled:opacity-50">
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

> NOTE during execution: confirm the actual prop names / signature on `RichInput` and `RichContentRenderer` against `src/components/ui/RichInput.jsx`. If they differ from the assumed `value/onChange/onMentionsChange/placeholder` shape, adjust the usage. Don't change `RichInput` itself.

**Step 3: Build `CardDetailPanel.jsx`** (slide-in panel; opened via `?card=<id>`)

Create `src/components/hub/cards/CardDetailPanel.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useHubCardColumns } from '../../../hooks/useHubCardColumns'
import { useHubCards } from '../../../hooks/useHubCards'
import { SlidePanel } from '../../ui/animations'
import { showToast } from '../../ui/index'
import CardSteps from './CardSteps'
import CardComments from './CardComments'
import { format, parseISO } from 'date-fns'
import { X, Trash2 } from 'lucide-react'

export default function CardDetailPanel({ moduleId }) {
  const [params, setParams] = useSearchParams()
  const cardId = params.get('card')
  const [card, setCard] = useState(null)
  const { columns } = useHubCardColumns(moduleId)
  const { updateCard, deleteCard, assignCard, unassignCard } = useHubCards(moduleId)

  useEffect(() => {
    if (!cardId) { setCard(null); return }
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('hub_cards')
        .select('*, assignees:hub_card_assignees(profile:profiles(id, full_name, avatar_url))')
        .eq('id', cardId).maybeSingle()
      if (alive && data) setCard({ ...data, assignees: (data.assignees || []).map(a => a.profile).filter(Boolean) })
    })()
    return () => { alive = false }
  }, [cardId])

  function close() {
    const next = new URLSearchParams(params)
    next.delete('card')
    setParams(next)
  }

  if (!cardId || !card) return null

  return (
    <SlidePanel open onClose={close} side="right">
      <div className="p-5 max-w-2xl">
        <div className="flex items-start justify-between gap-2 mb-3">
          <input
            value={card.title}
            onChange={e => setCard({ ...card, title: e.target.value })}
            onBlur={() => updateCard(card.id, { title: card.title })}
            className="text-xl font-bold bg-transparent w-full focus:outline-none focus:ring-0"
          />
          <button onClick={close} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-dark-hover">
            <X size={16} />
          </button>
        </div>

        <dl className="grid grid-cols-[100px_1fr] gap-y-3 text-sm mb-5">
          <dt className="text-slate-500">Column</dt>
          <dd>
            <select
              value={card.column_id}
              onChange={async e => { await updateCard(card.id, { column_id: e.target.value }); setCard({ ...card, column_id: e.target.value }) }}
              className="form-input py-1 text-sm"
            >
              {columns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </dd>

          <dt className="text-slate-500">Due on</dt>
          <dd>
            <input
              type="date"
              value={card.due_date || ''}
              onChange={async e => {
                const v = e.target.value || null
                await updateCard(card.id, { due_date: v })
                setCard({ ...card, due_date: v })
              }}
              className="form-input py-1 text-sm"
            />
          </dd>

          <dt className="text-slate-500">Assigned</dt>
          <dd className="flex items-center gap-1">
            {(card.assignees || []).map(a => (
              <span key={a.id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 dark:bg-dark-hover rounded-full text-xs">
                {a.full_name}
                <button onClick={() => unassignCard(card.id, a.id)} className="text-slate-400 hover:text-red-500"><X size={11} /></button>
              </span>
            ))}
            {/* Assignee picker (omitted here for brevity — reuse the existing
               assignee picker patterns from AssignTaskPage / HubMembersPanel
               during execution). */}
          </dd>
        </dl>

        <section className="mb-5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Notes</h4>
          <textarea
            value={card.notes || ''}
            onChange={e => setCard({ ...card, notes: e.target.value })}
            onBlur={() => updateCard(card.id, { notes: card.notes })}
            placeholder="Add notes…"
            rows={6}
            className="form-input w-full text-sm"
          />
        </section>

        <section className="mb-5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Steps</h4>
          <CardSteps cardId={card.id} />
        </section>

        <section className="mb-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Comments</h4>
          <CardComments cardId={card.id} />
        </section>

        <div className="pt-3 border-t border-slate-100 dark:border-dark-border flex justify-end">
          <button
            onClick={async () => {
              if (!confirm('Delete this card?')) return
              const ok = await deleteCard(card.id)
              if (ok) { showToast('Card deleted'); close() }
            }}
            className="btn btn-ghost text-red-500 text-sm inline-flex items-center gap-1"
          >
            <Trash2 size={13} /> Delete card
          </button>
        </div>
      </div>
    </SlidePanel>
  )
}
```

> NOTE during execution: the assignee picker is intentionally stubbed in the snippet above ("Assignee picker (omitted here for brevity)"). Reuse the existing picker pattern from `AssignTaskPage.jsx` or `HubMembersPanel.jsx` to render an `Add assignee` chip that opens a member popover.

**Step 4: Wire `CardDetailPanel` into `HubPage.jsx` so it lives over the hub grid**

In `src/pages/HubPage.jsx`, find the JSX block where `<ExpandedModuleModal>` is rendered conditionally. **Below** that block, render `<CardDetailPanel>` for whichever module the `?card=<id>` query points at — but only when the URL has `card` set. Since one hub may have many Card Tables, the panel needs to know which module the card belongs to. Resolve by reading `hub_cards.module_id` once.

Add at the appropriate place in `HubDashboard()`:

```jsx
{/* Card detail panel (?card=<id>) — opens over the hub grid for any
    Card Table module in this hub. */}
<HubCardDetailRouter hubId={hubId} />
```

And add a small `HubCardDetailRouter` component at the bottom of the file (or import it from `src/components/hub/cards/HubCardDetailRouter.jsx`):

```jsx
function HubCardDetailRouter({ hubId }) {
  const [params] = useSearchParams()
  const cardId = params.get('card')
  const [moduleId, setModuleId] = useState(null)
  useEffect(() => {
    if (!cardId) { setModuleId(null); return }
    let alive = true
    ;(async () => {
      const { data } = await supabase.from('hub_cards').select('module_id').eq('id', cardId).maybeSingle()
      if (alive) setModuleId(data?.module_id || null)
    })()
    return () => { alive = false }
  }, [cardId])
  if (!cardId || !moduleId) return null
  return <CardDetailPanel moduleId={moduleId} />
}
```

**Step 5: Build**

```bash
npm run build
```

**Step 6: Commit**

```bash
git add src/components/hub/cards/CardDetailPanel.jsx \
        src/components/hub/cards/CardSteps.jsx \
        src/components/hub/cards/CardComments.jsx \
        src/pages/HubPage.jsx
git commit -m "feat(card-table): card detail panel with steps + comments + URL deep link"
```

---

## Task 8: Wire `card-table` kind into `useHubModules` + AddModuleModal

**Files:**
- Modify: `src/hooks/useHubModules.js` (add `card-table` to `KIND_ORDER` + `KIND_DEFAULT_TITLE`)
- Modify: `src/pages/HubPage.jsx` (add `card-table` entry to `KIND_META`)

**Step 1: Extend `useHubModules.js` constants**

In `src/hooks/useHubModules.js`, change:

```javascript
const KIND_ORDER = ['message-board', 'attendance-room', 'campfire', 'docs-files', 'to-dos']
const KIND_DEFAULT_TITLE = {
  'message-board':   'Message Board',
  'attendance-room': "Who's Here",
  'campfire':        'Campfire',
  'docs-files':      'Docs & Files',
  'to-dos':          'To-Dos',
}
```

to:

```javascript
const KIND_ORDER = ['message-board', 'attendance-room', 'campfire', 'docs-files', 'to-dos', 'card-table']
const KIND_DEFAULT_TITLE = {
  'message-board':   'Message Board',
  'attendance-room': "Who's Here",
  'campfire':        'Campfire',
  'docs-files':      'Docs & Files',
  'to-dos':          'To-Dos',
  'card-table':      'Card Table',
}
```

**Step 2: Extend `KIND_META` in `src/pages/HubPage.jsx`**

Add the import:

```javascript
import CardTable from '../components/hub/cards/CardTable'
```

Add the lucide icon import (alongside the others):

```javascript
import {
  Users, Flame, MessageSquare, FolderOpen, ArrowLeft, CheckSquare,
  Pencil, Check, X as XIcon, Plus, RotateCcw, LayoutGrid,
} from 'lucide-react'
```

Add the entry to `KIND_META`:

```javascript
export const KIND_META = {
  'message-board':   { icon: MessageSquare, color: '#7c3aed', defaultOpen: true,  Comp: MessageBoard },
  'to-dos':          { icon: CheckSquare,   color: '#8b5cf6', defaultOpen: true,  Comp: TodosModuleCard },
  'docs-files':      { icon: FolderOpen,    color: '#0284c7', defaultOpen: false, Comp: DocsFiles },
  'campfire':        { icon: Flame,         color: '#dc2626', defaultOpen: true,  Comp: Campfire },
  'attendance-room': { icon: Users,         color: '#8b5cf6', defaultOpen: true,  Comp: Attendance },
  'card-table':      { icon: LayoutGrid,    color: '#0d9488', defaultOpen: true,  Comp: CardTable },
}
```

**Step 3: Verify `AddModuleModal` picks it up**

Open `src/components/hub/AddModuleModal.jsx`. It imports `HUB_MODULE_KINDS` and `HUB_MODULE_DEFAULT_TITLE` from `useHubModules`. Confirm the new kind appears in the kind picker. No code change needed in the modal.

**Step 4: Build + tests**

```bash
npm run test:run && npm run build
```

Expected: 333+/333+ tests pass (added 3 new card helper tests in Task 2), build clean.

**Step 5: Commit**

```bash
git add src/hooks/useHubModules.js src/pages/HubPage.jsx
git commit -m "feat(card-table): register card-table as a hub module kind"
```

---

## Task 9: Update `notification-digest` edge function — render card sections

**Files:**
- Modify: `supabase/functions/notification-digest/index.ts`

**Step 1: Read current digest renderer**

```bash
sed -n '1,80p' supabase/functions/notification-digest/index.ts
```

Locate the `renderDigestHtml` function (or equivalent) and identify where each `event_type` is rendered into a section.

**Step 2: Add card sections**

Add three new branches (modeled on the existing `task_assigned` / `comment_posted` / `comment_mention` branches):

- `card_assigned` → "You were assigned to a card: <title> in <hub name>"  → link to `/hub/<hubId>?card=<cardId>`
- `card_comment` → "<author> commented on <card title>"  → same link
- `card_mention` → "<author> mentioned you on <card title>"  → same link

The payload already carries `card_id`, `hub_id`, `card_title` (set by the trigger in migration 069). The author's name should be resolved from `profiles` via the existing helper the function already uses for task comments — copy that pattern.

**Step 3: Deploy edge function**

```bash
SUPABASE_ACCESS_TOKEN=$(grep ^SUPABASE_ACCESS_TOKEN .env.local | cut -d= -f2) \
  supabase functions deploy notification-digest --project-ref urdzocyfxgyhqmoqbuvk
```

Expected: "Deployed successfully".

**Step 4: Commit**

```bash
git add supabase/functions/notification-digest/index.ts
git commit -m "feat(card-table): notification-digest renders card sections"
```

---

## Task 10: Smoke test on the running dev server

**Manual test (requires logged-in admin account):**

1. Run `npm run dev`. Open `http://localhost:5173/`.
2. Navigate to any hub. Click **Add module** → choose **Card Table** → submit. The new module card appears.
3. Click into the Card Table module (or expand it). Click **Add the first column** → name it "To do".
4. Add another column "In progress", another "Done". Verify the colors differ.
5. Click **Add a card** in "To do" → type a title → Enter. Card appears in column.
6. Drag the card to "In progress". Verify it sticks after a hard refresh.
7. Click the card → detail panel opens with `?card=<id>` in URL.
8. Set a due date, add an assignee, type notes, add a step. Verify all save.
9. Add a comment with an `@mention`. Verify it appears immediately.
10. **Open the URL with `?card=<id>` in a new tab** — panel deep-links.
11. **Open in a second browser as a different hub member** — verify they see the same board, can drag cards (realtime), and that `@mention` notifications hit their bell.
12. **In a third browser as an external (Agent/Client) NOT in the hub** — verify they never see the Card Table module or any card.

**Automated check:**

```bash
npm run test:run && npm run build
```

Expected: green.

**Final commit (only if any test-fix tweaks were needed):**

```bash
git commit -am "fix(card-table): smoke-test follow-ups"
```

---

## Verification checklist before merging to main

- [ ] Migration 069 applied to cloud staging (Management API returns `[]`)
- [ ] All 6 new tables have RLS enabled and self-only / hub-member policies
- [ ] `comments.card_id` FK + CHECK exactly-one-not-null in place
- [ ] `notification_outbox.event_type` CHECK includes the 3 new card events
- [ ] Vitest 333+/333+ passing (3 new card helper tests added)
- [ ] `npm run build` clean
- [ ] Smoke test 1-12 above all pass
- [ ] No regression: existing **My Tasks**, **Reports**, **Hubs (other modules)**, **Chat widget** all still work
- [ ] Card detail deep link (`/hub/<hubId>?card=<id>`) opens the panel
- [ ] An external user cannot see Card Tables in hubs they're not invited to
- [ ] Notification digest email renders card sections with correct deep link

---

## Future work (NOT in this plan)

1. **Card-comment reactions** — same model as DM message reactions; small new table `comment_reactions` (polymorphic on comment id; gated by comments RLS).
2. **Per-card "boost"** (Basecamp's heart/rocket) — a `hub_card_reactions(card_id, profile_id, emoji)` table.
3. **Drag-reorder of columns** — would mirror Card-table column repositioning.
4. **"Move along to →" quick action** on the card header (Basecamp's UI) — a small dropdown that respects column order.
5. **Per-user board layout** — extending the migration 068 pattern for column order overrides per user, if teams ask. Skip unless asked.
6. **Activity stream view** — interleaving `hub_card_audit_log` + `comments` chronologically inside the detail panel (right now we render them as separate sections).
