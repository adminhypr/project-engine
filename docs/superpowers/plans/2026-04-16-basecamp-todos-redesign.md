# Basecamp-Style To-Dos Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hub to-dos module's inline-accordion UI with a Basecamp-faithful experience: dedicated pages per list and per item, rich notes with attachments, per-item subscribers, soft-delete with undo, list colours, activity-feed integration.

**Architecture:** One extension migration (`023_hub_todos_v2.sql`) on top of the existing 022 schema. A new `HubTodosPage` route mounts three nested React Router routes (index, list, item). The existing hub module grid keeps a compact preview card that links into the new routes. Notifications fan out via a new `hub-todo-notify` edge function; `hub-mention-notify` gains a dedup rule for `todo_comment` mentions.

**Tech Stack:** React 18 + Vite, React Router v6, Tailwind CSS, Supabase (Postgres + Realtime + Storage + Edge Functions/Deno + Resend), Vitest.

**Reference spec:** `docs/superpowers/specs/2026-04-16-basecamp-todos-redesign-design.md`

---

## File Structure

**New files:**
```
supabase/migrations/
  023_hub_todos_v2.sql                    schema + triggers + backfill + storage bucket

supabase/functions/hub-todo-notify/
  index.ts                                completion + comment fan-out

src/pages/
  HubTodosPage.jsx                        routes wrapper; mounts useHubTodos(hubId)

src/components/hub/todos/
  TodosModuleCard.jsx                     compact preview in the hub module grid
  TodosIndex.jsx                          /hub/:hubId/todos
  TodoListPage.jsx                        /hub/:hubId/todos/:listId
  TodoItemPage.jsx                        /hub/:hubId/todos/:listId/items/:itemId
  NewListForm.jsx                         inline-expanded "new list" card
  NewItemForm.jsx                         inline-expanded "new to-do" card
  TodoListRow.jsx                         list card on the index
  TodoItemRow.jsx                         item row inside a list page
  TodoBreadcrumb.jsx                      shared breadcrumb
  TodoSubscribers.jsx                     subscribers block on item page
  TrashedToast.jsx                        "… is in the trash — Undo" toast
  RichTextField.jsx                       RichInput + toolbar (B/I/link/bullet/numbered/attach)
  todoColors.js                           TODO_LIST_COLORS palette constant

src/hooks/
  useHubTodoSubscribers.js                NEW
  useHubTodoAttachments.js                NEW

src/lib/__tests__/
  todoColors.test.js                      palette mapping test
```

**Modified files:**
```
src/hooks/useHubTodos.js                  + color, deleted_at, attachments, undoDelete
src/hooks/useHubTodoComments.js           + entity_type already 'todo_comment'; no-op except wiring
src/components/ui/RichContentRenderer.jsx + attachments rendering
src/App.jsx                               + /hub/:hubId/todos/* route
src/pages/HubPage.jsx                     swap Todos → TodosModuleCard in MODULE_COMPONENTS
supabase/functions/hub-mention-notify/
  index.ts                                + dedup for todo_comment subscribers
```

**Deleted files:**
```
src/components/hub/Todos.jsx
src/components/hub/TodoItem.jsx
src/components/hub/TodoItemDetail.jsx
```

---

## Task 1: Migration 023 — schema additions (columns, table, bucket, RLS)

**Files:**
- Create: `supabase/migrations/023_hub_todos_v2.sql`

- [ ] **Step 1: Create migration file with schema additions**

Create `supabase/migrations/023_hub_todos_v2.sql` containing:

```sql
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
```

- [ ] **Step 2: Add RLS for subscribers (mirrors assignees)**

Append to the same file:

```sql
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
```

- [ ] **Step 3: Add auto-subscribe triggers**

Append:

```sql
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
```

- [ ] **Step 4: Add new activity-feed triggers (completion + assigned)**

Append:

```sql
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
  for each row execute function public.hub_activity_on_todo_completed();

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
```

- [ ] **Step 5: Backfill subscribers for existing items**

Append:

```sql
-- Backfill: creators
insert into public.hub_todo_item_subscribers (item_id, profile_id)
  select id, created_by from public.hub_todo_items
  on conflict (item_id, profile_id) do nothing;

-- Backfill: assignees
insert into public.hub_todo_item_subscribers (item_id, profile_id)
  select item_id, profile_id from public.hub_todo_item_assignees
  on conflict (item_id, profile_id) do nothing;
```

- [ ] **Step 6: Update SELECT RLS to hide soft-deleted rows**

Append:

```sql
-- Drop + recreate SELECT policies to filter deleted_at

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
```

- [ ] **Step 7: Apply the migration**

Run the migration against the dev Supabase project. Two options, depending on how the repo is set up locally:

Option A (Supabase CLI linked):
```bash
npx supabase db push
```
Expected: `Applying 023_hub_todos_v2.sql…` then `Done.`

Option B (dashboard): open Supabase Dashboard → SQL Editor → paste the file contents → Run. Expected: `Success. No rows returned.`

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/023_hub_todos_v2.sql
git commit -m "feat: migration 023 — to-dos v2 schema (color, soft-delete, subscribers, activity)"
```

---

## Task 2: Create `hub-todo-attachments` storage bucket

**Files:**
- Modify: `supabase/migrations/023_hub_todos_v2.sql` (append bucket + RLS)

- [ ] **Step 1: Append bucket creation + policies to migration 023**

Append to the bottom of `supabase/migrations/023_hub_todos_v2.sql`:

```sql
-- ─────────────────────────────────────────────
-- Storage bucket: hub-todo-attachments
-- ─────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('hub-todo-attachments', 'hub-todo-attachments', false, 10485760)
on conflict (id) do update set file_size_limit = 10485760;

-- Read: any hub member (for any list/item in their hubs)
create policy "hub_todo_attachments_read" on storage.objects for select using (
  bucket_id = 'hub-todo-attachments'
  and exists (
    select 1 from public.hub_members hm
    where hm.profile_id = auth.uid()
    and hm.hub_id::text = (storage.foldername(name))[1]
  )
);

-- Write: any hub member, into their hub's prefix
create policy "hub_todo_attachments_write" on storage.objects for insert with check (
  bucket_id = 'hub-todo-attachments'
  and exists (
    select 1 from public.hub_members hm
    where hm.profile_id = auth.uid()
    and hm.hub_id::text = (storage.foldername(name))[1]
  )
);

-- Delete: uploader or hub owner/admin or global Admin
create policy "hub_todo_attachments_delete" on storage.objects for delete using (
  bucket_id = 'hub-todo-attachments'
  and (
    owner = auth.uid()
    or exists (
      select 1 from public.hub_members hm
      where hm.profile_id = auth.uid()
      and hm.hub_id::text = (storage.foldername(name))[1]
      and hm.role in ('owner','admin')
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'Admin')
  )
);
```

- [ ] **Step 2: Re-apply the migration**

If you used Option A in Task 1:
```bash
npx supabase db reset
```
and replay all migrations cleanly.

If Option B: paste the appended section only into the SQL Editor and run. Expected: `Success.`

- [ ] **Step 3: Verify bucket exists**

In Supabase Dashboard → Storage → buckets: confirm `hub-todo-attachments` is listed (private, 10 MB limit).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/023_hub_todos_v2.sql
git commit -m "feat: hub-todo-attachments storage bucket + RLS"
```

---

## Task 3: Color palette constant + test

**Files:**
- Create: `src/components/hub/todos/todoColors.js`
- Create: `src/lib/__tests__/todoColors.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/todoColors.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { TODO_LIST_COLORS, todoColorClass, todoColorKeys } from '../../components/hub/todos/todoColors'

describe('todoColors', () => {
  it('defines seven color tokens', () => {
    expect(todoColorKeys).toEqual(['blue','green','red','yellow','purple','orange','gray'])
  })

  it('maps every token to a non-empty Tailwind class', () => {
    for (const key of todoColorKeys) {
      expect(TODO_LIST_COLORS[key]).toMatch(/^bg-/)
    }
  })

  it('returns the default (blue) class when key is unknown or missing', () => {
    expect(todoColorClass(undefined)).toBe(TODO_LIST_COLORS.blue)
    expect(todoColorClass('nope')).toBe(TODO_LIST_COLORS.blue)
    expect(todoColorClass(null)).toBe(TODO_LIST_COLORS.blue)
  })

  it('returns the mapped class for known keys', () => {
    expect(todoColorClass('green')).toBe(TODO_LIST_COLORS.green)
    expect(todoColorClass('red')).toBe(TODO_LIST_COLORS.red)
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test -- src/lib/__tests__/todoColors.test.js
```
Expected: FAIL — `Cannot find module '../../components/hub/todos/todoColors'`.

- [ ] **Step 3: Implement**

Create `src/components/hub/todos/todoColors.js`:

```js
export const TODO_LIST_COLORS = {
  blue:   'bg-brand-500',
  green:  'bg-green-500',
  red:    'bg-red-500',
  yellow: 'bg-yellow-500',
  purple: 'bg-purple-500',
  orange: 'bg-orange-500',
  gray:   'bg-slate-400',
}

export const todoColorKeys = ['blue','green','red','yellow','purple','orange','gray']

export function todoColorClass(key) {
  return TODO_LIST_COLORS[key] || TODO_LIST_COLORS.blue
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npm test -- src/lib/__tests__/todoColors.test.js
```
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/components/hub/todos/todoColors.js src/lib/__tests__/todoColors.test.js
git commit -m "feat: TODO_LIST_COLORS palette + test"
```

---

## Task 4: Extend `useHubTodos` hook (color, soft-delete, undo, attachments)

**Files:**
- Modify: `src/hooks/useHubTodos.js`

- [ ] **Step 1: Update query to filter soft-deleted rows**

In `src/hooks/useHubTodos.js`, modify the `fetchData` callback — add `.is('deleted_at', null)` to both selects:

```js
const fetchData = useCallback(async () => {
  if (!hubRef.current) return
  const [{ data: listData, error: lErr }, { data: itemData, error: iErr }] = await Promise.all([
    supabase
      .from('hub_todo_lists')
      .select('*, creator:profiles!hub_todo_lists_created_by_fkey(id, full_name, avatar_url)')
      .eq('hub_id', hubRef.current)
      .is('deleted_at', null)
      .order('position'),
    supabase
      .from('hub_todo_items')
      .select('*, creator:profiles!hub_todo_items_created_by_fkey(id, full_name, avatar_url), completer:profiles!hub_todo_items_completed_by_fkey(id, full_name), hub_todo_item_assignees(profile_id, profiles(id, full_name, avatar_url))')
      .eq('hub_id', hubRef.current)
      .is('deleted_at', null)
      .order('position')
  ])
  if (lErr || iErr) showToast('Failed to load to-dos', 'error')
  setLists(listData || [])
  setItems(itemData || [])
  setLoading(false)
}, [])
```

- [ ] **Step 2: Update `createList` to accept color + description + attachments**

Replace `createList`:

```js
const createList = useCallback(async (input) => {
  if (!hubRef.current || !profile?.id) return null
  const { title, description = null, color = 'blue', attachments = [] } = input || {}
  if (!title?.trim()) return null
  const position = lists.length
  const { data, error } = await supabase.from('hub_todo_lists').insert({
    hub_id: hubRef.current, created_by: profile.id,
    title: title.trim(), description, color,
    attachments: attachments.map(({ preview, ...rest }) => rest),
    position
  }).select().single()
  if (error) { showToast('Failed to create list', 'error'); return null }
  await fetchData()
  return data
}, [profile?.id, lists.length, fetchData])
```

- [ ] **Step 3: Replace `deleteList` with soft-delete + `undoDeleteList`**

Replace `deleteList` and add `undoDeleteList`:

```js
const deleteList = useCallback(async (id) => {
  const { error } = await supabase.from('hub_todo_lists')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) { showToast('Failed to delete list', 'error'); return false }
  await fetchData()
  return true
}, [fetchData])

const undoDeleteList = useCallback(async (id) => {
  const { error } = await supabase.from('hub_todo_lists')
    .update({ deleted_at: null })
    .eq('id', id)
  if (error) { showToast('Failed to restore list', 'error'); return false }
  await fetchData()
  return true
}, [fetchData])
```

- [ ] **Step 4: Same soft-delete treatment for items**

Replace `deleteItem` and add `undoDeleteItem`:

```js
const deleteItem = useCallback(async (id) => {
  const { error } = await supabase.from('hub_todo_items')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  if (error) { showToast('Failed to delete to-do', 'error'); return false }
  await fetchData()
  return true
}, [fetchData])

const undoDeleteItem = useCallback(async (id) => {
  const { error } = await supabase.from('hub_todo_items')
    .update({ deleted_at: null })
    .eq('id', id)
  if (error) { showToast('Failed to restore to-do', 'error'); return false }
  await fetchData()
  return true
}, [fetchData])
```

- [ ] **Step 5: Update `createItem` to accept the richer form payload**

Replace `createItem`:

```js
const createItem = useCallback(async (listId, input) => {
  if (!hubRef.current || !profile?.id) return null
  // Back-compat: allow `createItem(listId, "just a title")` for quick inline add.
  const payload = typeof input === 'string' ? { title: input } : (input || {})
  const { title, notes = null, due_date = null, assigneeIds = [], attachments = [] } = payload
  if (!title?.trim()) return null

  const listItems = items.filter(i => i.list_id === listId)
  const position = listItems.length
  const { data, error } = await supabase.from('hub_todo_items').insert({
    list_id: listId, hub_id: hubRef.current, created_by: profile.id,
    title: title.trim(), notes, due_date,
    attachments: attachments.map(({ preview, ...rest }) => rest),
    position
  }).select().single()
  if (error) { showToast('Failed to add to-do', 'error'); return null }
  if (assigneeIds.length > 0) {
    await supabase.from('hub_todo_item_assignees').insert(
      assigneeIds.map(pid => ({ item_id: data.id, profile_id: pid }))
    )
  }
  await fetchData()
  return data
}, [profile?.id, items, fetchData])
```

- [ ] **Step 6: Update `updateItem` to support `attachments` field**

In the existing `updateItem`, extend the payload unwrapping block:

```js
const updateItem = useCallback(async (id, updates, mentions = []) => {
  const payload = { ...updates }
  if (mentions.length > 0) payload.mentions = mentions
  if (payload.inlineImages) {
    payload.inline_images = payload.inlineImages.map(({ preview, ...rest }) => rest)
    delete payload.inlineImages
  }
  if (payload.attachments) {
    payload.attachments = payload.attachments.map(({ preview, ...rest }) => rest)
  }
  // …rest unchanged
```

- [ ] **Step 7: Update the hook's return to expose undo helpers**

Replace the return block at the bottom of `useHubTodos.js`:

```js
return {
  lists, items, loading,
  createList, updateList, deleteList, undoDeleteList, reorderLists,
  createItem, toggleItem, updateItem, deleteItem, undoDeleteItem, reorderItems, setAssignees,
  refetch: fetchData
}
```

- [ ] **Step 8: Manual check — confirm it still loads**

Run the dev server (`npm run dev`), open a hub. Observe the old `Todos.jsx` still works (no new features used yet). Expected: lists/items load. No console errors.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useHubTodos.js
git commit -m "feat: extend useHubTodos (color, soft-delete+undo, attachments, rich createItem)"
```

---

## Task 5: New `useHubTodoSubscribers` hook

**Files:**
- Create: `src/hooks/useHubTodoSubscribers.js`

- [ ] **Step 1: Implement**

Create `src/hooks/useHubTodoSubscribers.js`:

```js
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

export function useHubTodoSubscribers(itemId) {
  const { profile } = useAuth()
  const [subscribers, setSubscribers] = useState([])
  const [loading, setLoading] = useState(true)
  const itemRef = useRef(itemId)
  itemRef.current = itemId

  const fetchSubs = useCallback(async () => {
    if (!itemRef.current) return
    const { data, error } = await supabase
      .from('hub_todo_item_subscribers')
      .select('profile_id, created_at, profile:profiles(id, full_name, avatar_url, email)')
      .eq('item_id', itemRef.current)
      .order('created_at')
    if (error) showToast('Failed to load subscribers', 'error')
    setSubscribers(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!itemId) return
    setLoading(true)
    setSubscribers([])
    fetchSubs()
  }, [itemId, fetchSubs])

  useEffect(() => {
    if (!itemId) return
    const channel = supabase
      .channel(`hub-todo-subs-${itemId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_todo_item_subscribers', filter: `item_id=eq.${itemId}` },
        () => fetchSubs()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [itemId, fetchSubs])

  const subscribe = useCallback(async (profileId) => {
    if (!itemRef.current) return false
    const target = profileId || profile?.id
    if (!target) return false
    const { error } = await supabase
      .from('hub_todo_item_subscribers')
      .insert({ item_id: itemRef.current, profile_id: target })
    if (error && !error.message.includes('duplicate key')) {
      showToast('Failed to subscribe', 'error'); return false
    }
    await fetchSubs()
    return true
  }, [profile?.id, fetchSubs])

  const unsubscribe = useCallback(async (profileId) => {
    if (!itemRef.current) return false
    const target = profileId || profile?.id
    if (!target) return false
    const { error } = await supabase
      .from('hub_todo_item_subscribers')
      .delete()
      .eq('item_id', itemRef.current)
      .eq('profile_id', target)
    if (error) { showToast('Failed to unsubscribe', 'error'); return false }
    await fetchSubs()
    return true
  }, [profile?.id, fetchSubs])

  const isSubscribed = subscribers.some(s => s.profile_id === profile?.id)

  return { subscribers, loading, isSubscribed, subscribe, unsubscribe }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useHubTodoSubscribers.js
git commit -m "feat: useHubTodoSubscribers hook (list, subscribe, unsubscribe, realtime)"
```

---

## Task 6: New `useHubTodoAttachments` hook

**Files:**
- Create: `src/hooks/useHubTodoAttachments.js`

- [ ] **Step 1: Implement**

Create `src/hooks/useHubTodoAttachments.js`:

```js
import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const BUCKET = 'hub-todo-attachments'

export function useHubTodoAttachments(hubId) {
  const { profile } = useAuth()
  const [uploading, setUploading] = useState([])

  const uploadFile = useCallback(async (file) => {
    if (!hubId || !profile?.id) return null
    if (file.size > MAX_FILE_SIZE) {
      showToast(`${file.name} exceeds 10 MB limit`, 'error')
      return null
    }

    const tempId = crypto.randomUUID()
    setUploading(prev => [...prev, { id: tempId, name: file.name }])

    const uid = crypto.randomUUID()
    const storagePath = `${hubId}/${uid}_${file.name}`

    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file)
    setUploading(prev => prev.filter(u => u.id !== tempId))

    if (error) { showToast(`Upload failed: ${file.name}`, 'error'); return null }

    return {
      path: storagePath,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
    }
  }, [hubId, profile?.id])

  const signedUrl = useCallback(async (path) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    return data?.signedUrl || null
  }, [])

  const removeFile = useCallback(async (path) => {
    const { error } = await supabase.storage.from(BUCKET).remove([path])
    if (error) { showToast('Failed to remove file', 'error'); return false }
    return true
  }, [])

  return { uploadFile, signedUrl, removeFile, uploading }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useHubTodoAttachments.js
git commit -m "feat: useHubTodoAttachments hook (upload/sign/remove in hub-todo-attachments bucket)"
```

---

## Task 7: `RichTextField` — toolbar wrapper around `RichInput`

**Files:**
- Create: `src/components/hub/todos/RichTextField.jsx`

- [ ] **Step 1: Implement**

Create `src/components/hub/todos/RichTextField.jsx`:

```jsx
import { useRef, useState } from 'react'
import RichInput from '../../ui/RichInput'
import { useHubTodoAttachments } from '../../../hooks/useHubTodoAttachments'
import { Bold, Italic, Link as LinkIcon, List, ListOrdered, Paperclip, X, FileText } from 'lucide-react'

// Markdown-style surround/prefix transform on the current selection.
function applyWrap(textarea, before, after = before) {
  if (!textarea) return
  const { selectionStart: s, selectionEnd: e, value } = textarea
  const sel = value.slice(s, e)
  const next = value.slice(0, s) + before + sel + after + value.slice(e)
  textarea.value = next
  textarea.focus()
  textarea.selectionStart = s + before.length
  textarea.selectionEnd = e + before.length
  const event = new Event('input', { bubbles: true })
  textarea.dispatchEvent(event)
}

function applyLinePrefix(textarea, prefix) {
  if (!textarea) return
  const { selectionStart: s, value } = textarea
  const before = value.slice(0, s)
  const lineStart = before.lastIndexOf('\n') + 1
  const next = value.slice(0, lineStart) + prefix + value.slice(lineStart)
  textarea.value = next
  textarea.focus()
  textarea.selectionStart = s + prefix.length
  textarea.selectionEnd = s + prefix.length
  const event = new Event('input', { bubbles: true })
  textarea.dispatchEvent(event)
}

export default function RichTextField({
  value, onChange, onSubmit, submitRef,
  hubId, placeholder, rows = 4,
  attachments = [], onAttachmentsChange,
}) {
  const wrapRef = useRef(null)
  const fileInputRef = useRef(null)
  const { uploadFile, uploading } = useHubTodoAttachments(hubId)

  function findTextarea() {
    return wrapRef.current?.querySelector('textarea') || null
  }

  async function handleFilePick(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    const next = [...attachments]
    for (const file of files) {
      const uploaded = await uploadFile(file)
      if (uploaded) next.push(uploaded)
    }
    onAttachmentsChange?.(next)
  }

  function removeAttachment(path) {
    onAttachmentsChange?.(attachments.filter(a => a.path !== path))
  }

  const btn = "p-1.5 rounded hover:bg-slate-100 dark:hover:bg-dark-hover text-slate-500 dark:text-slate-400 transition-colors"

  return (
    <div ref={wrapRef} className="rounded-xl border border-slate-200 dark:border-dark-border overflow-hidden">
      <div className="flex items-center gap-0.5 px-2 py-1 border-b border-slate-100 dark:border-dark-border bg-slate-50 dark:bg-dark-bg/50">
        <button type="button" className={btn} onClick={() => applyWrap(findTextarea(), '**')} title="Bold"><Bold size={14} /></button>
        <button type="button" className={btn} onClick={() => applyWrap(findTextarea(), '_')}  title="Italic"><Italic size={14} /></button>
        <button type="button" className={btn} onClick={() => applyWrap(findTextarea(), '[', '](url)')} title="Link"><LinkIcon size={14} /></button>
        <span className="w-px h-4 bg-slate-200 dark:bg-dark-border mx-1" />
        <button type="button" className={btn} onClick={() => applyLinePrefix(findTextarea(), '- ')}  title="Bullet list"><List size={14} /></button>
        <button type="button" className={btn} onClick={() => applyLinePrefix(findTextarea(), '1. ')} title="Numbered list"><ListOrdered size={14} /></button>
        <span className="w-px h-4 bg-slate-200 dark:bg-dark-border mx-1" />
        <button type="button" className={btn} onClick={() => fileInputRef.current?.click()} title="Attach file"><Paperclip size={14} /></button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilePick} />
      </div>

      <div className="p-2 bg-white dark:bg-dark-card">
        <RichInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          submitRef={submitRef}
          hubId={hubId}
          enableMentions
          enableImages
          placeholder={placeholder}
          rows={rows}
          className="border-0 bg-transparent p-1"
        />
      </div>

      {(attachments.length > 0 || uploading.length > 0) && (
        <div className="flex flex-wrap gap-2 px-2 py-2 border-t border-slate-100 dark:border-dark-border bg-slate-50 dark:bg-dark-bg/50">
          {attachments.map(a => (
            <div key={a.path} className="flex items-center gap-2 text-xs px-2 py-1 rounded-lg bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border">
              <FileText size={12} className="text-slate-400" />
              <span className="text-slate-700 dark:text-slate-300 truncate max-w-[160px]">{a.name}</span>
              <button type="button" onClick={() => removeAttachment(a.path)} className="text-slate-400 hover:text-red-500">
                <X size={10} />
              </button>
            </div>
          ))}
          {uploading.map(u => (
            <div key={u.id} className="flex items-center gap-2 text-xs px-2 py-1 rounded-lg bg-white/50 dark:bg-dark-card/50 border border-slate-200 dark:border-dark-border opacity-70">
              <div className="w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-slate-500 truncate max-w-[160px]">{u.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/hub/todos/RichTextField.jsx
git commit -m "feat: RichTextField — toolbar + attachments wrapper around RichInput"
```

---

## Task 8: Extend `RichContentRenderer` to show attachments

**Files:**
- Modify: `src/components/ui/RichContentRenderer.jsx`

- [ ] **Step 1: Accept an `attachments` prop and render chips**

In `src/components/ui/RichContentRenderer.jsx`, change the signature to accept `attachments` and an optional `attachmentBucket`:

```jsx
export default function RichContentRenderer({ content, mentions = [], inlineImages = [], attachments = [], attachmentBucket = 'hub-files' }) {
  const [signedUrls, setSignedUrls] = useState({})
  const [attSignedUrls, setAttSignedUrls] = useState({})
  const [modalImage, setModalImage] = useState(null)

  // …existing signAll effect for inlineImages unchanged…

  useEffect(() => {
    if (attachments.length === 0) return
    let cancelled = false
    async function signAll() {
      const urls = {}
      for (const a of attachments) {
        const { data } = await supabase.storage.from(attachmentBucket).createSignedUrl(a.path, 3600)
        if (data?.signedUrl) urls[a.path] = data.signedUrl
      }
      if (!cancelled) setAttSignedUrls(urls)
    }
    signAll()
    return () => { cancelled = true }
  }, [attachments, attachmentBucket])
```

- [ ] **Step 2: Render the attachments block after images**

Just before the `{modalImage …}` line, insert:

```jsx
{attachments.length > 0 && (
  <div className="flex flex-wrap gap-2 mt-2">
    {attachments.map((a, i) => {
      const url = attSignedUrls[a.path]
      return (
        <a
          key={a.path + i}
          href={url || '#'}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-dark-bg/50 border border-slate-200 dark:border-dark-border hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors"
        >
          <span className="text-slate-500 dark:text-slate-400">📎</span>
          <span className="text-slate-700 dark:text-slate-300 truncate max-w-[160px]">{a.name}</span>
        </a>
      )
    })}
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/RichContentRenderer.jsx
git commit -m "feat: RichContentRenderer — render attachment chips with signed URLs"
```

---

## Task 9: Small shared components — `TodoBreadcrumb`, `TrashedToast`

**Files:**
- Create: `src/components/hub/todos/TodoBreadcrumb.jsx`
- Create: `src/components/hub/todos/TrashedToast.jsx`

- [ ] **Step 1: Implement `TodoBreadcrumb`**

Create `src/components/hub/todos/TodoBreadcrumb.jsx`:

```jsx
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

export default function TodoBreadcrumb({ segments }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-3">
      {segments.map((s, i) => {
        const isLast = i === segments.length - 1
        return (
          <span key={i} className="flex items-center gap-1.5">
            {isLast || !s.to ? (
              <span className="text-slate-700 dark:text-slate-300 font-medium truncate">{s.label}</span>
            ) : (
              <Link to={s.to} className="hover:text-brand-600 dark:hover:text-brand-400 truncate">{s.label}</Link>
            )}
            {!isLast && <ChevronRight size={12} className="text-slate-300 dark:text-slate-600 shrink-0" />}
          </span>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: Implement `TrashedToast`**

Create `src/components/hub/todos/TrashedToast.jsx`:

```jsx
import { useEffect, useState } from 'react'

export default function TrashedToast({ message, onUndo, onDismiss, durationMs = 30000 }) {
  const [remaining, setRemaining] = useState(durationMs)

  useEffect(() => {
    if (remaining <= 0) { onDismiss?.(); return }
    const t = setTimeout(() => setRemaining(r => r - 1000), 1000)
    return () => clearTimeout(t)
  }, [remaining, onDismiss])

  const secs = Math.ceil(remaining / 1000)

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-900 text-white shadow-elevated text-sm">
      <span>✓ {message}</span>
      <button
        onClick={() => { onUndo?.(); onDismiss?.() }}
        className="underline font-semibold hover:text-brand-300"
      >
        Undo
      </button>
      <span className="text-xs text-slate-400 tabular-nums">{secs}s</span>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/hub/todos/TodoBreadcrumb.jsx src/components/hub/todos/TrashedToast.jsx
git commit -m "feat: TodoBreadcrumb + TrashedToast shared components"
```

---

## Task 10: `TodoSubscribers` component

**Files:**
- Create: `src/components/hub/todos/TodoSubscribers.jsx`

- [ ] **Step 1: Implement**

Create `src/components/hub/todos/TodoSubscribers.jsx`:

```jsx
import { useState } from 'react'
import { useAuth } from '../../../hooks/useAuth'
import { useHubTodoSubscribers } from '../../../hooks/useHubTodoSubscribers'
import { useHubMembers } from '../../../hooks/useHubMembers'
import { Users, Plus, Check } from 'lucide-react'

export default function TodoSubscribers({ itemId, hubId }) {
  const { profile } = useAuth()
  const { subscribers, isSubscribed, subscribe, unsubscribe } = useHubTodoSubscribers(itemId)
  const { members } = useHubMembers(hubId)
  const [showPicker, setShowPicker] = useState(false)

  const subIds = new Set(subscribers.map(s => s.profile_id))

  async function toggleMember(mId) {
    if (subIds.has(mId)) await unsubscribe(mId)
    else await subscribe(mId)
  }

  return (
    <div className="border-t border-slate-100 dark:border-dark-border pt-5">
      <div className="flex items-center gap-2 mb-3">
        <Users size={14} className="text-slate-400" />
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">Subscribers</h4>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
        {subscribers.length === 0
          ? 'No one will be notified about new comments.'
          : `${subscribers.length} ${subscribers.length === 1 ? 'person' : 'people'} will be notified when someone comments.`}
      </p>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        {subscribers.map(s => {
          const p = s.profile
          if (!p) return null
          return p.avatar_url ? (
            <img key={p.id} src={p.avatar_url} title={p.full_name} alt="" className="w-7 h-7 rounded-full ring-2 ring-white dark:ring-dark-card" />
          ) : (
            <div key={p.id} title={p.full_name} className="w-7 h-7 rounded-full bg-brand-500 ring-2 ring-white dark:ring-dark-card flex items-center justify-center text-white text-[10px] font-bold">
              {p.full_name?.[0] || '?'}
            </div>
          )
        })}
        <button
          onClick={() => setShowPicker(v => !v)}
          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border border-slate-200 dark:border-dark-border text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-dark-hover"
        >
          <Plus size={11} />
          Add/remove people
        </button>
      </div>

      {showPicker && (
        <div className="mb-4 p-2 rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card max-h-60 overflow-y-auto space-y-0.5">
          {members.map(m => {
            const p = m.profile || m
            if (!p?.id) return null
            const selected = subIds.has(p.id)
            return (
              <button
                key={p.id}
                onClick={() => toggleMember(p.id)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm hover:bg-slate-50 dark:hover:bg-dark-hover ${selected ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`}
              >
                {p.avatar_url ? (
                  <img src={p.avatar_url} className="w-6 h-6 rounded-full" alt="" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-[10px] font-bold">
                    {p.full_name?.[0] || '?'}
                  </div>
                )}
                <span className="flex-1 text-slate-700 dark:text-slate-300 truncate">{p.full_name}</span>
                {selected && <Check size={14} className="text-brand-500 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-dark-border">
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {isSubscribed ? "You're subscribed" : "You're not subscribed"}
        </span>
        {isSubscribed ? (
          <button onClick={() => unsubscribe()} className="btn btn-ghost text-xs px-2 py-1">Unsubscribe me</button>
        ) : (
          <button onClick={() => subscribe()} className="btn btn-secondary text-xs px-2 py-1">Subscribe me</button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/hub/todos/TodoSubscribers.jsx
git commit -m "feat: TodoSubscribers component (list, add/remove, self-subscribe)"
```

---

## Task 11: `HubTodosPage` + routes wiring

**Files:**
- Create: `src/pages/HubTodosPage.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Implement `HubTodosPage`**

Create `src/pages/HubTodosPage.jsx`:

```jsx
import { Routes, Route, useParams } from 'react-router-dom'
import { useHubTodos } from '../hooks/useHubTodos'
import { useHubs } from '../hooks/useHubs'
import { Spinner } from '../components/ui/index'
import { PageTransition } from '../components/ui/animations'
import TodosIndex from '../components/hub/todos/TodosIndex'
import TodoListPage from '../components/hub/todos/TodoListPage'
import TodoItemPage from '../components/hub/todos/TodoItemPage'

export default function HubTodosPage() {
  const { hubId } = useParams()
  const todos = useHubTodos(hubId)
  const { hubs } = useHubs()
  const hub = hubs.find(h => h.id === hubId)

  if (todos.loading) return <div className="py-20 flex justify-center"><Spinner /></div>

  const ctx = { ...todos, hubId, hub }

  return (
    <PageTransition>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Routes>
          <Route index                    element={<TodosIndex   {...ctx} />} />
          <Route path=":listId"           element={<TodoListPage {...ctx} />} />
          <Route path=":listId/items/:itemId" element={<TodoItemPage {...ctx} />} />
        </Routes>
      </div>
    </PageTransition>
  )
}
```

- [ ] **Step 2: Register the route in `App.jsx`**

In `src/App.jsx`, add the import and route line:

```jsx
import HubTodosPage from './pages/HubTodosPage'
```

Add this route directly after the existing `/hub/:hubId` route:

```jsx
<Route path="/hub/:hubId/todos/*" element={<HubTodosPage />} />
```

- [ ] **Step 3: Verify the route resolves**

```bash
npm run dev
```
Navigate to `http://localhost:5173/hub/<any-hub-id>/todos`. Expected: a page renders (blank content is fine — `TodosIndex` isn't built yet, so expect an import error). Confirm the URL is accepted by the router.

> If you get a "module not found" error on `TodosIndex`, that's expected — next task creates it.

- [ ] **Step 4: Commit**

```bash
git add src/pages/HubTodosPage.jsx src/App.jsx
git commit -m "feat: HubTodosPage route wrapper + /hub/:hubId/todos/* wiring"
```

---

## Task 12: `TodosIndex` + `NewListForm` + `TodoListRow`

**Files:**
- Create: `src/components/hub/todos/TodosIndex.jsx`
- Create: `src/components/hub/todos/NewListForm.jsx`
- Create: `src/components/hub/todos/TodoListRow.jsx`

- [ ] **Step 1: Implement `NewListForm`**

Create `src/components/hub/todos/NewListForm.jsx`:

```jsx
import { useState, useRef } from 'react'
import RichTextField from './RichTextField'
import { todoColorKeys, todoColorClass } from './todoColors'

export default function NewListForm({ hubId, onCreate, onCancel }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('blue')
  const [attachments, setAttachments] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const notesSubmitRef = useRef(null)

  async function handleCreate(e) {
    e.preventDefault()
    if (!title.trim() || submitting) return
    setSubmitting(true)
    const created = await onCreate({ title: title.trim(), description: description || null, color, attachments })
    setSubmitting(false)
    if (created) onCancel?.()
  }

  return (
    <form onSubmit={handleCreate} className="rounded-2xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card p-4 space-y-3 shadow-soft">
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Name this list…"
        className="form-input w-full text-base font-semibold border-0 bg-transparent focus:ring-0 px-0"
      />

      <RichTextField
        value={description}
        onChange={setDescription}
        onSubmit={() => { /* notes submit via outer form button */ }}
        submitRef={notesSubmitRef}
        hubId={hubId}
        placeholder="Add extra details or attach a file…"
        rows={3}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
      />

      <div className="flex items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-1.5">
          {todoColorKeys.map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setColor(k)}
              className={`w-5 h-5 rounded-full ${todoColorClass(k)} ${color === k ? 'ring-2 ring-offset-2 ring-brand-500 dark:ring-offset-dark-card' : ''}`}
              title={k}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="btn btn-ghost text-xs">Cancel</button>
          <button type="submit" disabled={!title.trim() || submitting} className="btn btn-primary text-xs disabled:opacity-40">
            {submitting ? 'Adding…' : 'Add this list'}
          </button>
        </div>
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Implement `TodoListRow`**

Create `src/components/hub/todos/TodoListRow.jsx`:

```jsx
import { Link } from 'react-router-dom'
import { todoColorClass } from './todoColors'

export default function TodoListRow({ list, hubId }) {
  const total = list.totalItems
  const done = list.completedItems
  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <Link
      to={`/hub/${hubId}/todos/${list.id}`}
      className="block rounded-2xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card px-4 py-3.5 hover:border-brand-300 dark:hover:border-brand-500/40 transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className={`w-3 h-3 rounded-full shrink-0 ${todoColorClass(list.color)}`} />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{list.title}</h3>
          {list.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{list.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-20 h-1.5 bg-slate-100 dark:bg-dark-border rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-slate-400 tabular-nums">{done}/{total}</span>
        </div>
      </div>
    </Link>
  )
}
```

- [ ] **Step 3: Implement `TodosIndex`**

Create `src/components/hub/todos/TodosIndex.jsx`:

```jsx
import { useState, useMemo } from 'react'
import { Plus } from 'lucide-react'
import TodoBreadcrumb from './TodoBreadcrumb'
import NewListForm from './NewListForm'
import TodoListRow from './TodoListRow'
import TrashedToast from './TrashedToast'

export default function TodosIndex({ hubId, hub, lists, items, createList, deleteList, undoDeleteList }) {
  const [showNewList, setShowNewList] = useState(false)
  const [trashedListId, setTrashedListId] = useState(null)

  const enriched = useMemo(() => lists.map(list => {
    const listItems = items.filter(i => i.list_id === list.id)
    return { ...list, totalItems: listItems.length, completedItems: listItems.filter(i => i.completed).length }
  }), [lists, items])

  return (
    <div>
      <TodoBreadcrumb segments={[
        { label: hub?.name || 'Hub', to: `/hub/${hubId}` },
        { label: 'To-dos' },
      ]} />

      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setShowNewList(v => !v)}
          className="btn btn-primary text-xs flex items-center gap-1.5"
        >
          <Plus size={13} />
          New list
        </button>
        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-200">To-dos</h1>
        <div className="w-[74px]" />
      </div>

      {showNewList && (
        <div className="mb-4">
          <NewListForm
            hubId={hubId}
            onCreate={createList}
            onCancel={() => setShowNewList(false)}
          />
        </div>
      )}

      {enriched.length === 0 && !showNewList && (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-12">
          No lists yet. Click <span className="font-semibold">New list</span> to start one.
        </p>
      )}

      <div className="space-y-2.5">
        {enriched.map(list => (
          <TodoListRow key={list.id} list={list} hubId={hubId} />
        ))}
      </div>

      {trashedListId && (
        <TrashedToast
          message="The to-do list is in the trash."
          onUndo={() => undoDeleteList(trashedListId)}
          onDismiss={() => setTrashedListId(null)}
        />
      )}
    </div>
  )
}
```

> `trashedListId` is plumbed but not yet triggered from this page (delete happens on the list page). Leave the toast rendering here so it stays visible even if the user navigates back after deleting.

- [ ] **Step 4: Verify**

Run `npm run dev`, open `http://localhost:5173/hub/<hub-id>/todos`. Expected: breadcrumb, "New list" button, existing lists as cards. Clicking `New list` expands the form; clicking a list card navigates to `/hub/:hubId/todos/:listId` (which 404-ish renders nothing — next task fixes).

- [ ] **Step 5: Commit**

```bash
git add src/components/hub/todos/TodosIndex.jsx src/components/hub/todos/NewListForm.jsx src/components/hub/todos/TodoListRow.jsx
git commit -m "feat: TodosIndex + NewListForm + TodoListRow (index page with Basecamp layout)"
```

---

## Task 13: `TodoListPage` + `NewItemForm` + `TodoItemRow`

**Files:**
- Create: `src/components/hub/todos/TodoListPage.jsx`
- Create: `src/components/hub/todos/NewItemForm.jsx`
- Create: `src/components/hub/todos/TodoItemRow.jsx`

- [ ] **Step 1: Implement `TodoItemRow`**

Create `src/components/hub/todos/TodoItemRow.jsx`:

```jsx
import { Link } from 'react-router-dom'

const isOverdue  = d => d && new Date(d + 'T23:59:59') < new Date()
const isDueToday = d => d && d === new Date().toISOString().split('T')[0]
const fmt        = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null

export default function TodoItemRow({ item, hubId, listId, onToggle }) {
  const assignees = item.hub_todo_item_assignees || []
  const overdue = !item.completed && isOverdue(item.due_date)
  const dueToday = !item.completed && isDueToday(item.due_date)

  return (
    <div className="group flex items-center gap-2 px-4 py-2 hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors border-b border-slate-100 dark:border-dark-border last:border-b-0">
      <button
        onClick={e => { e.preventDefault(); onToggle(item.id, item.completed) }}
        className={`w-[18px] h-[18px] rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
          item.completed
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-slate-300 dark:border-slate-600 hover:border-brand-500'
        }`}
      >
        {item.completed && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <Link to={`/hub/${hubId}/todos/${listId}/items/${item.id}`} className="flex-1 min-w-0 flex items-center gap-2">
        <span className={`text-sm truncate ${item.completed ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-300'}`}>
          {item.title}
        </span>
        {item.due_date && !item.completed && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 font-medium ${
            overdue ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400'
            : dueToday ? 'bg-orange-100 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400'
            : 'bg-slate-100 text-slate-500 dark:bg-dark-border dark:text-slate-400'
          }`}>
            {fmt(item.due_date)}
          </span>
        )}
      </Link>

      {assignees.length > 0 && (
        <div className="flex -space-x-1.5 shrink-0">
          {assignees.slice(0, 3).map(a => {
            const p = a.profiles || a.profile
            if (!p) return null
            return p.avatar_url ? (
              <img key={p.id} src={p.avatar_url} className="w-5 h-5 rounded-full ring-2 ring-white dark:ring-dark-card" alt={p.full_name} title={p.full_name} />
            ) : (
              <div key={p.id} title={p.full_name} className="w-5 h-5 rounded-full bg-brand-500 ring-2 ring-white dark:ring-dark-card flex items-center justify-center text-white text-[9px] font-bold">
                {p.full_name?.[0] || '?'}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Implement `NewItemForm`**

Create `src/components/hub/todos/NewItemForm.jsx`:

```jsx
import { useState, useRef } from 'react'
import { useHubMembers } from '../../../hooks/useHubMembers'
import RichTextField from './RichTextField'
import { Check, Plus } from 'lucide-react'

export default function NewItemForm({ listId, hubId, onCreate, onCancel }) {
  const { members } = useHubMembers(hubId)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assigneeIds, setAssigneeIds] = useState([])
  const [attachments, setAttachments] = useState([])
  const [showAssignees, setShowAssignees] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const notesSubmitRef = useRef(null)

  function toggleAssignee(id) {
    setAssigneeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim() || submitting) return
    setSubmitting(true)
    const created = await onCreate(listId, {
      title: title.trim(),
      notes: notes || null,
      due_date: dueDate || null,
      assigneeIds,
      attachments,
    })
    setSubmitting(false)
    if (created) onCancel?.()
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card p-3 space-y-3">
      <div className="flex items-center gap-2 border-b border-slate-100 dark:border-dark-border pb-2">
        <div className="w-[18px] h-[18px] rounded border-2 border-slate-300 dark:border-slate-600 shrink-0" />
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Describe this to-do…"
          className="form-input flex-1 border-0 bg-transparent focus:ring-0 px-0 text-sm"
        />
      </div>

      <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-2 text-xs items-start pl-7">
        <span className="text-slate-500 dark:text-slate-400 pt-1">Assigned to</span>
        <button
          type="button"
          onClick={() => setShowAssignees(v => !v)}
          className="text-left text-slate-700 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400"
        >
          {assigneeIds.length === 0 ? <span className="text-slate-400">Type names to assign…</span>
            : assigneeIds.length === 1 ? members.find(m => (m.profile || m).id === assigneeIds[0])?.profile?.full_name
            : `${assigneeIds.length} people`}
        </button>

        {showAssignees && (
          <div className="col-start-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card p-1 space-y-0.5">
            {members.map(m => {
              const p = m.profile || m
              if (!p?.id) return null
              const selected = assigneeIds.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleAssignee(p.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-slate-50 dark:hover:bg-dark-hover ${selected ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`}
                >
                  <span className="flex-1 truncate">{p.full_name}</span>
                  {selected && <Check size={12} className="text-brand-500" />}
                </button>
              )
            })}
          </div>
        )}

        <span className="text-slate-500 dark:text-slate-400 pt-1">Due on</span>
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          className="form-input text-xs py-1 px-2 w-40"
        />

        <span className="text-slate-500 dark:text-slate-400 pt-1">Notes</span>
        <div>
          <RichTextField
            value={notes}
            onChange={setNotes}
            onSubmit={() => {}}
            submitRef={notesSubmitRef}
            hubId={hubId}
            placeholder="Add extra details or attach a file…"
            rows={3}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn btn-ghost text-xs">Cancel</button>
        <button type="submit" disabled={!title.trim() || submitting} className="btn btn-primary text-xs disabled:opacity-40">
          {submitting ? 'Adding…' : 'Add this to-do'}
        </button>
      </div>
    </form>
  )
}
```

- [ ] **Step 3: Implement `TodoListPage`**

Create `src/components/hub/todos/TodoListPage.jsx`:

```jsx
import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Plus, Trash2, EyeOff, Eye } from 'lucide-react'
import TodoBreadcrumb from './TodoBreadcrumb'
import NewItemForm from './NewItemForm'
import TodoItemRow from './TodoItemRow'
import TrashedToast from './TrashedToast'
import { todoColorClass } from './todoColors'

export default function TodoListPage({ hubId, hub, lists, items, createItem, toggleItem, deleteItem, undoDeleteItem, deleteList, undoDeleteList }) {
  const { listId } = useParams()
  const navigate = useNavigate()
  const [showNew, setShowNew] = useState(false)
  const [hideCompleted, setHideCompleted] = useState(false)
  const [trashedItemId, setTrashedItemId] = useState(null)

  const list = lists.find(l => l.id === listId)
  const listItems = useMemo(() => items.filter(i => i.list_id === listId), [items, listId])

  if (!list) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-slate-500">List not found.</p>
      </div>
    )
  }

  const total = listItems.length
  const done  = listItems.filter(i => i.completed).length
  const visible = hideCompleted ? listItems.filter(i => !i.completed) : listItems

  async function handleDeleteList() {
    if (!window.confirm(`Delete "${list.title}" and all its to-dos?`)) return
    await deleteList(list.id)
    navigate(`/hub/${hubId}/todos`)
    // Note: toast lives on the index page; pass via query string or accept it stays inline here.
  }

  return (
    <div>
      <TodoBreadcrumb segments={[
        { label: hub?.name || 'Hub', to: `/hub/${hubId}` },
        { label: 'To-dos',            to: `/hub/${hubId}/todos` },
        { label: list.title },
      ]} />

      <div className="flex items-center gap-3 mb-4">
        <span className={`w-3.5 h-3.5 rounded-full shrink-0 ${todoColorClass(list.color)}`} />
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-white truncate">{list.title}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{done}/{total} completed</p>
        </div>
        {done > 0 && (
          <button
            onClick={() => setHideCompleted(v => !v)}
            className="btn btn-ghost text-xs flex items-center gap-1"
            title={hideCompleted ? 'Show completed' : 'Hide completed'}
          >
            {hideCompleted ? <Eye size={12} /> : <EyeOff size={12} />}
            {hideCompleted ? 'Show completed' : 'Hide completed'}
          </button>
        )}
        <button onClick={handleDeleteList} className="btn btn-ghost text-xs text-red-500 flex items-center gap-1">
          <Trash2 size={12} /> Delete list
        </button>
      </div>

      {list.description && (
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 whitespace-pre-wrap">{list.description}</p>
      )}

      <div className="rounded-2xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card overflow-hidden mb-4">
        {showNew ? (
          <div className="p-3">
            <NewItemForm
              listId={list.id}
              hubId={hubId}
              onCreate={createItem}
              onCancel={() => setShowNew(false)}
            />
          </div>
        ) : (
          <button
            onClick={() => setShowNew(true)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm text-slate-400 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-dark-hover"
          >
            <Plus size={14} />
            Add a to-do
          </button>
        )}

        {visible.map(item => (
          <TodoItemRow
            key={item.id}
            item={item}
            hubId={hubId}
            listId={list.id}
            onToggle={toggleItem}
          />
        ))}

        {visible.length === 0 && !showNew && (
          <p className="text-center text-xs text-slate-400 py-6">No to-dos yet.</p>
        )}
      </div>

      {trashedItemId && (
        <TrashedToast
          message="The to-do is in the trash."
          onUndo={() => undoDeleteItem(trashedItemId)}
          onDismiss={() => setTrashedItemId(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verify**

`npm run dev`, create a list, click into it. Expected: list page renders, `Add a to-do` expands the form, items save, breadcrumb is correct, delete-list button routes back to the index.

- [ ] **Step 5: Commit**

```bash
git add src/components/hub/todos/TodoListPage.jsx src/components/hub/todos/NewItemForm.jsx src/components/hub/todos/TodoItemRow.jsx
git commit -m "feat: TodoListPage + NewItemForm + TodoItemRow"
```

---

## Task 14: `TodoItemPage`

**Files:**
- Create: `src/components/hub/todos/TodoItemPage.jsx`

- [ ] **Step 1: Implement**

Create `src/components/hub/todos/TodoItemPage.jsx`:

```jsx
import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHubTodoComments } from '../../../hooks/useHubTodoComments'
import { useHubMembers } from '../../../hooks/useHubMembers'
import { useAuth } from '../../../hooks/useAuth'
import RichInput from '../../ui/RichInput'
import RichContentRenderer from '../../ui/RichContentRenderer'
import RichTextField from './RichTextField'
import TodoBreadcrumb from './TodoBreadcrumb'
import TodoSubscribers from './TodoSubscribers'
import TrashedToast from './TrashedToast'
import { Spinner } from '../../ui/index'
import { Trash2, Calendar, Users, Check } from 'lucide-react'

export default function TodoItemPage({ hubId, hub, lists, items, updateItem, deleteItem, undoDeleteItem, toggleItem, setAssignees }) {
  const { listId, itemId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { members } = useHubMembers(hubId)
  const { comments, loading: commentsLoading, addComment, deleteComment } = useHubTodoComments(itemId, hubId)

  const list = lists.find(l => l.id === listId)
  const item = items.find(i => i.id === itemId)

  const [title, setTitle] = useState(item?.title || '')
  const [notes, setNotes] = useState(item?.notes || '')
  const [attachments, setAttachments] = useState(item?.attachments || [])
  const [dueDate, setDueDate] = useState(item?.due_date || '')
  const [showAssignees, setShowAssignees] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [saving, setSaving] = useState(false)
  const [trashed, setTrashed] = useState(false)

  const notesSubmitRef = useRef(null)
  const commentSubmitRef = useRef(null)

  useEffect(() => {
    if (!item) return
    setTitle(item.title)
    setNotes(item.notes || '')
    setAttachments(item.attachments || [])
    setDueDate(item.due_date || '')
  }, [item?.id, item?.title, item?.notes, item?.attachments, item?.due_date])

  if (!item || !list) {
    return <div className="text-center py-12 text-sm text-slate-500">To-do not found.</div>
  }

  const assigneeIds = (item.hub_todo_item_assignees || []).map(a => (a.profiles || a.profile)?.id).filter(Boolean)

  async function handleSaveTitle() {
    if (title.trim() && title.trim() !== item.title) {
      await updateItem(item.id, { title: title.trim() })
    }
  }
  async function handleSaveNotes({ content, mentions }) {
    setSaving(true)
    await updateItem(item.id, { notes: content, attachments }, mentions)
    setSaving(false)
  }
  async function handleDueChange(e) {
    const val = e.target.value || null
    setDueDate(val || '')
    await updateItem(item.id, { due_date: val })
  }
  async function handleToggleAssignee(pid) {
    const next = assigneeIds.includes(pid) ? assigneeIds.filter(x => x !== pid) : [...assigneeIds, pid]
    await setAssignees(item.id, next)
  }
  async function handleAddComment({ content, mentions, inlineImages }) {
    if (!content.trim()) return
    await addComment(content, mentions, inlineImages)
    setCommentText('')
  }
  async function handleDelete() {
    if (!window.confirm('Delete this to-do?')) return
    await deleteItem(item.id)
    setTrashed(true)
    setTimeout(() => navigate(`/hub/${hubId}/todos/${listId}`), 250)
  }

  return (
    <div>
      <TodoBreadcrumb segments={[
        { label: hub?.name || 'Hub', to: `/hub/${hubId}` },
        { label: 'To-dos',            to: `/hub/${hubId}/todos` },
        { label: list.title,          to: `/hub/${hubId}/todos/${listId}` },
        { label: item.title || 'Item' },
      ]} />

      {/* Title + checkbox */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => toggleItem(item.id, item.completed)}
          className={`w-6 h-6 rounded border-2 shrink-0 flex items-center justify-center ${
            item.completed
              ? 'bg-green-500 border-green-500 text-white'
              : 'border-slate-300 dark:border-slate-600 hover:border-brand-500'
          }`}
        >
          {item.completed && <Check size={14} />}
        </button>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={handleSaveTitle}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          className={`flex-1 text-xl font-bold bg-transparent outline-none ${item.completed ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'}`}
        />
        <button onClick={handleDelete} className="p-1.5 text-slate-400 hover:text-red-500" title="Delete">
          <Trash2 size={16} />
        </button>
      </div>

      {/* Meta row */}
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-3 text-xs mb-6">
        <div className="flex items-center gap-2 text-slate-500"><Users size={13} /><span>Assigned</span></div>
        <div>
          <button onClick={() => setShowAssignees(v => !v)} className="hover:text-brand-600 dark:hover:text-brand-400 text-slate-700 dark:text-slate-300">
            {assigneeIds.length === 0 ? <span className="text-slate-400">No one</span>
              : assigneeIds.length === 1 ? members.find(m => (m.profile || m).id === assigneeIds[0])?.profile?.full_name
              : `${assigneeIds.length} people`}
          </button>
          {showAssignees && (
            <div className="mt-2 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card p-1 max-h-40 overflow-y-auto space-y-0.5">
              {members.map(m => {
                const p = m.profile || m
                if (!p?.id) return null
                const selected = assigneeIds.includes(p.id)
                return (
                  <button key={p.id} onClick={() => handleToggleAssignee(p.id)} className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left ${selected ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`}>
                    <span className="flex-1 truncate">{p.full_name}</span>
                    {selected && <Check size={12} className="text-brand-500" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-slate-500"><Calendar size={13} /><span>Due on</span></div>
        <input type="date" value={dueDate} onChange={handleDueChange} className="form-input text-xs py-1 px-2 w-40" />
      </div>

      {/* Notes */}
      <div className="mb-6">
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Notes</h4>
        {item.notes && (
          <div className="mb-2 text-sm text-slate-700 dark:text-slate-300">
            <RichContentRenderer
              content={item.notes}
              mentions={item.mentions || []}
              inlineImages={item.inline_images || []}
              attachments={item.attachments || []}
              attachmentBucket="hub-todo-attachments"
            />
          </div>
        )}
        <RichTextField
          value={notes}
          onChange={setNotes}
          onSubmit={handleSaveNotes}
          submitRef={notesSubmitRef}
          hubId={hubId}
          placeholder="Add notes, @mention people…"
          rows={2}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
        />
        <div className="flex justify-end mt-2">
          <button onClick={() => notesSubmitRef.current?.()} disabled={saving} className="btn btn-primary text-xs px-3 py-1 disabled:opacity-40">
            {saving ? 'Saving…' : 'Save notes'}
          </button>
        </div>
      </div>

      {/* Comments */}
      <div className="mb-6">
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
          Comments {comments.length > 0 && `(${comments.length})`}
        </h4>
        {commentsLoading ? <Spinner /> : (
          <div className="space-y-3">
            {comments.map(c => (
              <div key={c.id} className="flex items-start gap-2">
                {c.author?.avatar_url ? (
                  <img src={c.author.avatar_url} className="w-6 h-6 rounded-full mt-0.5" alt="" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-[8px] font-bold mt-0.5">
                    {c.author?.full_name?.[0] || '?'}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{c.author?.full_name}</span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                    {c.created_by === profile?.id && (
                      <button onClick={() => deleteComment(c.id)} className="text-[10px] text-slate-300 hover:text-red-500 ml-auto">Delete</button>
                    )}
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                    <RichContentRenderer content={c.content} mentions={c.mentions || []} inlineImages={c.inline_images || []} />
                  </div>
                </div>
              </div>
            ))}

            <div className="flex items-start gap-2">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} className="w-6 h-6 rounded-full mt-0.5" alt="" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-[8px] font-bold mt-0.5">
                  {profile?.full_name?.[0] || '?'}
                </div>
              )}
              <div className="flex-1">
                <RichInput
                  value={commentText}
                  onChange={setCommentText}
                  onSubmit={handleAddComment}
                  submitRef={commentSubmitRef}
                  hubId={hubId}
                  enableMentions
                  enableImages={false}
                  placeholder="Add a comment here…"
                  rows={1}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <TodoSubscribers itemId={item.id} hubId={hubId} />

      {trashed && (
        <TrashedToast
          message="The to-do is in the trash."
          onUndo={() => { undoDeleteItem(item.id); setTrashed(false) }}
          onDismiss={() => setTrashed(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Open an item. Expected: breadcrumb (4 segments), title edits inline, notes save, comments post, subscribers block at the bottom shows me + assignees.

- [ ] **Step 3: Commit**

```bash
git add src/components/hub/todos/TodoItemPage.jsx
git commit -m "feat: TodoItemPage (full item detail with comments + subscribers)"
```

---

## Task 15: `TodosModuleCard` + wire into `HubPage.jsx` + delete old files

**Files:**
- Create: `src/components/hub/todos/TodosModuleCard.jsx`
- Modify: `src/pages/HubPage.jsx`
- Delete: `src/components/hub/Todos.jsx`, `src/components/hub/TodoItem.jsx`, `src/components/hub/TodoItemDetail.jsx`

- [ ] **Step 1: Implement `TodosModuleCard`**

Create `src/components/hub/todos/TodosModuleCard.jsx`:

```jsx
import { Link } from 'react-router-dom'
import { useHubTodos } from '../../../hooks/useHubTodos'
import { todoColorClass } from './todoColors'
import { Spinner } from '../../ui/index'
import { ArrowRight } from 'lucide-react'

const PREVIEW_LIMIT = 5

export default function TodosModuleCard({ hubId }) {
  const { lists, items, loading } = useHubTodos(hubId)

  if (loading) return <div className="py-6 flex justify-center"><Spinner /></div>

  const enriched = lists.slice(0, PREVIEW_LIMIT).map(list => {
    const listItems = items.filter(i => i.list_id === list.id)
    return {
      ...list,
      totalItems: listItems.length,
      completedItems: listItems.filter(i => i.completed).length,
    }
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {lists.length} {lists.length === 1 ? 'list' : 'lists'}
        </span>
        <Link
          to={`/hub/${hubId}/todos`}
          className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
        >
          Open <ArrowRight size={11} />
        </Link>
      </div>

      {enriched.length === 0 ? (
        <Link to={`/hub/${hubId}/todos`} className="block text-center text-xs text-slate-400 py-4 hover:text-brand-600">
          No lists yet — Open to-dos
        </Link>
      ) : (
        <div className="space-y-2">
          {enriched.map(list => {
            const pct = list.totalItems ? Math.round((list.completedItems / list.totalItems) * 100) : 0
            return (
              <Link
                key={list.id}
                to={`/hub/${hubId}/todos/${list.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-dark-hover"
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${todoColorClass(list.color)}`} />
                <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate">{list.title}</span>
                <div className="w-14 h-1 bg-slate-100 dark:bg-dark-border rounded-full overflow-hidden">
                  <div className={`h-full ${pct === 100 ? 'bg-green-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] text-slate-400 tabular-nums w-8 text-right">{list.completedItems}/{list.totalItems}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Swap the import and registration in `HubPage.jsx`**

In `src/pages/HubPage.jsx`, change:

```jsx
import Todos from '../components/hub/Todos'
```
to:
```jsx
import TodosModuleCard from '../components/hub/todos/TodosModuleCard'
```

And in the `MODULE_COMPONENTS` object, change `'to-dos': Todos` to `'to-dos': TodosModuleCard`.

- [ ] **Step 3: Delete the old files**

```bash
git rm src/components/hub/Todos.jsx src/components/hub/TodoItem.jsx src/components/hub/TodoItemDetail.jsx
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```
Expected: build succeeds. No references to the deleted files.

- [ ] **Step 5: Verify dev**

```bash
npm run dev
```
Open a hub. Expected: the To-Dos module card shows the preview list with progress rows. Clicking Open or a list row navigates into the new pages.

- [ ] **Step 6: Commit**

```bash
git add src/components/hub/todos/TodosModuleCard.jsx src/pages/HubPage.jsx
git commit -m "feat: TodosModuleCard preview + swap old Todos.jsx for new routes"
```

---

## Task 16: `hub-todo-notify` edge function

**Files:**
- Create: `supabase/functions/hub-todo-notify/index.ts`

- [ ] **Step 1: Implement the function**

Create `supabase/functions/hub-todo-notify/index.ts`:

```ts
// supabase/functions/hub-todo-notify/index.ts
// Email notifications for to-do completions + comments.
// Triggered by database webhooks on:
//   hub_todo_items    UPDATE (completed false → true)
//   hub_todo_comments INSERT
// Deploy: npx supabase functions deploy hub-todo-notify

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('ALERT_FROM_EMAIL') || 'alerts@hyprassistants.com'
const APP_URL = Deno.env.get('APP_URL') || 'https://tasks.hyprstaffing.com'

async function sendEmail(to: string[], subject: string, html: string) {
  if (!RESEND_API_KEY || to.length === 0) return false
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `Hypr Task <${FROM_EMAIL}>`, to, subject, html }),
  })
  if (!res.ok) { console.error('Resend error', res.status, await res.text()); return false }
  return true
}

function wrap(title: string, body: string) {
  return `<div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;background:#f8f9fc;padding:24px;">
    <div style="background:white;border-radius:16px;border:1px solid #e2e5ee;overflow:hidden;">
      <div style="background:#6366f1;padding:16px 24px;"><h2 style="margin:0;font-size:15px;color:white;font-weight:600;">${title}</h2></div>
      <div style="padding:24px;">${body}</div>
    </div>
  </div>`
}

async function subscribersFor(itemId: string): Promise<Array<{ id: string, email: string, full_name: string }>> {
  const { data } = await supabase
    .from('hub_todo_item_subscribers')
    .select('profile_id, profiles(id, email, full_name)')
    .eq('item_id', itemId)
  return (data || []).map((r: any) => r.profiles).filter((p: any) => p?.email)
}

async function handleCompletion(record: any) {
  if (!record.completed || !record.completed_by) return
  const { data: item } = await supabase
    .from('hub_todo_items')
    .select('id, title, list_id, hub_id')
    .eq('id', record.id).single()
  if (!item) return

  const { data: hub } = await supabase.from('hubs').select('name').eq('id', item.hub_id).single()
  const { data: completer } = await supabase.from('profiles').select('full_name').eq('id', record.completed_by).single()

  const subs = await subscribersFor(item.id)
  const recipients = subs.filter(p => p.id !== record.completed_by).map(p => p.email)
  if (recipients.length === 0) return

  const itemUrl = `${APP_URL}/hub/${item.hub_id}/todos/${item.list_id}/items/${item.id}`
  const html = wrap(`To-do completed in ${hub?.name || 'a hub'}`,
    `<p>${completer?.full_name || 'Someone'} marked <strong>${item.title}</strong> as done.</p>
     <p><a href="${itemUrl}" style="color:#6366f1;">Open to-do</a></p>`)
  await sendEmail(recipients, `${completer?.full_name || 'Someone'} completed: ${item.title}`, html)
}

async function handleComment(record: any) {
  const { data: item } = await supabase
    .from('hub_todo_items').select('id, title, list_id, hub_id').eq('id', record.item_id).single()
  if (!item) return

  const { data: hub } = await supabase.from('hubs').select('name').eq('id', item.hub_id).single()
  const { data: author } = await supabase.from('profiles').select('full_name').eq('id', record.created_by).single()

  const subs = await subscribersFor(item.id)
  const recipients = subs.filter(p => p.id !== record.created_by).map(p => p.email)
  if (recipients.length === 0) return

  const itemUrl = `${APP_URL}/hub/${item.hub_id}/todos/${item.list_id}/items/${item.id}`
  const preview = (record.content || '').slice(0, 200)
  const html = wrap(`New comment on a to-do in ${hub?.name || 'a hub'}`,
    `<p><strong>${author?.full_name || 'Someone'}</strong> commented on <strong>${item.title}</strong>:</p>
     <div style="background:#f8f9fc;padding:12px;border-radius:8px;margin:12px 0;">${preview}</div>
     <p><a href="${itemUrl}" style="color:#6366f1;">Open to-do</a></p>`)
  await sendEmail(recipients, `${author?.full_name || 'Someone'} commented: ${item.title}`, html)
}

Deno.serve(async (req) => {
  if (!RESEND_API_KEY) return new Response('{"error":"no RESEND_API_KEY"}', { status: 500 })
  try {
    const payload = await req.json()
    const { type, record, old_record, table } = payload

    if (table === 'hub_todo_items' && type === 'UPDATE') {
      if (old_record?.completed === false && record?.completed === true) {
        await handleCompletion(record)
      }
    } else if (table === 'hub_todo_comments' && type === 'INSERT') {
      await handleComment(record)
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  } catch (err) {
    console.error('hub-todo-notify error', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy hub-todo-notify
```
Expected: deployment succeeds, URL printed.

- [ ] **Step 3: Configure two database webhooks**

In Supabase Dashboard → Database → Webhooks → Create:

Webhook 1:
- Name: `hub-todo-notify-completion`
- Table: `hub_todo_items`
- Events: UPDATE
- URL: the function URL from Step 2
- HTTP: POST, JSON
- Conditions: none (function handles the false→true check itself)

Webhook 2:
- Name: `hub-todo-notify-comment`
- Table: `hub_todo_comments`
- Events: INSERT
- URL: same function URL
- HTTP: POST, JSON

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/hub-todo-notify/index.ts
git commit -m "feat: hub-todo-notify edge function (completion + comment subscriber fan-out)"
```

---

## Task 17: `hub-mention-notify` dedup for `todo_comment`

**Files:**
- Modify: `supabase/functions/hub-mention-notify/index.ts`

- [ ] **Step 1: Add subscriber dedup**

In `supabase/functions/hub-mention-notify/index.ts`, just before the `await sendEmail(...)` call, insert:

```ts
// Dedup: for to-do comment mentions, skip users who are already
// subscribed — hub-todo-notify will email them instead.
if (record.entity_type === 'todo_comment') {
  const { data: comment } = await supabase
    .from('hub_todo_comments')
    .select('item_id')
    .eq('id', record.entity_id)
    .single()
  if (comment?.item_id) {
    const { data: sub } = await supabase
      .from('hub_todo_item_subscribers')
      .select('profile_id')
      .eq('item_id', comment.item_id)
      .eq('profile_id', record.mentioned_user)
      .maybeSingle()
    if (sub) {
      return new Response(JSON.stringify({ action: 'dedup_subscriber', ok: true }), { status: 200 })
    }
  }
}
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy hub-mention-notify
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/hub-mention-notify/index.ts
git commit -m "feat: hub-mention-notify — skip todo_comment mentions when recipient is already a subscriber"
```

---

## Task 18: Add module label for `todo_comment` in mention emails

**Files:**
- Modify: `supabase/functions/hub-mention-notify/index.ts`

- [ ] **Step 1: Extend labels and preview fetcher**

In `hub-mention-notify/index.ts`, extend `MODULE_LABELS`:

```ts
const MODULE_LABELS: Record<string, string> = {
  chat: 'Campfire',
  message: 'Message Board',
  message_reply: 'Message Board',
  check_in_response: 'Check-ins',
  todo_note: 'To-dos',
  todo_comment: 'To-dos',
}
```

And extend `getMessagePreview` to handle both entity types:

```ts
} else if (entityType === 'todo_note') {
  const { data } = await supabase.from('hub_todo_items').select('notes').eq('id', entityId).single()
  content = data?.notes || ''
} else if (entityType === 'todo_comment') {
  const { data } = await supabase.from('hub_todo_comments').select('content').eq('id', entityId).single()
  content = data?.content || ''
}
```

- [ ] **Step 2: Deploy + commit**

```bash
npx supabase functions deploy hub-mention-notify
git add supabase/functions/hub-mention-notify/index.ts
git commit -m "feat: hub-mention-notify — preview + label for todo_note/todo_comment"
```

---

## Task 19: Manual verification checklist

**Files:** none (documentation)

- [ ] **Step 1: Run the checklist**

Open `http://localhost:5173`, sign in, enter a hub. Confirm each:

1. Module card shows up to 5 lists with progress + "Open →" link.
2. Clicking "Open" navigates to `/hub/:hubId/todos` with the Basecamp index layout.
3. "New list" expands inline. Title + description (rich-text) + 7-color picker + attachments.
4. Submitted list appears; clicking it routes to `/hub/:hubId/todos/:listId` with breadcrumb.
5. List page: color dot + title + description + `X/Y completed` + `Hide completed` toggle + `Delete list`.
6. `Add a to-do` expands full form (assigned to, due on, notes with attachments); Cancel collapses.
7. Item row checkbox toggles; strike-through applied; progress updates; an email fires to subscribers (check logs).
8. Clicking an item row navigates to `/hub/:hubId/todos/:listId/items/:itemId` with a 4-segment breadcrumb.
9. Item page: title, assignees, due date, notes, comments, subscribers section.
10. @mention in comment: mentioned user who is NOT a subscriber gets a mention email; mentioned user who IS a subscriber gets the subscriber email only (no duplicate).
11. Subscribe-me / Unsubscribe-me toggles my membership in real time.
12. Deleting list from list page → undo toast appears for 30s; undo restores; list re-appears.
13. Deleting item from item page → navigates back; undo toast appears; undo restores.
14. Hub activity feed shows `list created`, `to-do added`, `completed`, `assigned` events.

- [ ] **Step 2: Record any bugs as new tasks**

If any checklist item fails, create a task to fix it. Don't commit partial fixes as "complete".

- [ ] **Step 3: Final commit (if any fixups needed)**

```bash
git add <files>
git commit -m "fix: address verification-checklist findings"
```

---

## Self-Review

**Spec coverage:**
- ✅ Routes (index/list/item): Tasks 11-14
- ✅ Module preview: Task 15
- ✅ Schema v2 (color, soft-delete, attachments): Tasks 1-2, 4
- ✅ Subscribers table + triggers: Task 1, 5
- ✅ Backfill: Task 1 Step 5
- ✅ Storage bucket: Task 2
- ✅ Activity triggers: Task 1 Step 4
- ✅ `hub-todo-notify`: Task 16
- ✅ Mention dedup: Task 17
- ✅ Mention labels/preview for todo entities: Task 18
- ✅ Color palette + test: Task 3
- ✅ Manual QA: Task 19

**Placeholder scan:** no `TBD`/`TODO` entries. Every code block is complete.

**Type consistency:** `createList` returns the created row (or `null`), `createItem` same. `setAssignees(itemId, ids[])` unchanged. `subscribe/unsubscribe(profileId?)` — optional arg defaults to current user. `TodoItemRow` expects `{onToggle}` with signature `(id, currentlyCompleted)` — matches `toggleItem` in the hook.
