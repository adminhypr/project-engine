# Hub To-Dos Module — Design Spec

**Date:** 2026-04-15
**Branch:** basecamp
**Status:** Approved

## Overview

Add a Basecamp-style To-Dos module to Project Hubs. Users create named to-do lists within a hub, add items with optional assignees and due dates, check them off, and discuss individual items via comments. Integrates with the existing @mentions, activity feed, and realtime systems.

## Data Model

### `hub_todo_lists`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `hub_id` | uuid FK -> hubs | `ON DELETE CASCADE` |
| `created_by` | uuid FK -> profiles | |
| `title` | text NOT NULL | List name, e.g. "Launch Prep" |
| `description` | text | Optional list description |
| `position` | integer NOT NULL DEFAULT 0 | Ordering within the hub |
| `created_at` | timestamptz | `default now()` |
| `updated_at` | timestamptz | `default now()`, auto-updated via trigger |

Completion state is **computed client-side** (all items done = list complete). No stored boolean.

### `hub_todo_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `list_id` | uuid FK -> hub_todo_lists | `ON DELETE CASCADE` |
| `hub_id` | uuid FK -> hubs | Denormalized for RLS (avoids joining through lists) |
| `created_by` | uuid FK -> profiles | |
| `title` | text NOT NULL | The to-do text |
| `notes` | text | Rich text with @mentions |
| `mentions` | jsonb | `[{user_id, display_name}]` |
| `inline_images` | jsonb | Same pattern as hub_messages |
| `completed` | boolean DEFAULT false | |
| `completed_at` | timestamptz | Set when checked off |
| `completed_by` | uuid FK -> profiles | Who checked it off |
| `due_date` | date | Optional |
| `position` | integer NOT NULL DEFAULT 0 | Drag-and-drop ordering within the list |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Auto-updated via trigger |

### `hub_todo_item_assignees`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `item_id` | uuid FK -> hub_todo_items | `ON DELETE CASCADE` |
| `profile_id` | uuid FK -> profiles | |
| `created_at` | timestamptz | |

Unique constraint on `(item_id, profile_id)`.

### `hub_todo_comments`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `item_id` | uuid FK -> hub_todo_items | `ON DELETE CASCADE` |
| `hub_id` | uuid FK -> hubs | Denormalized for RLS |
| `created_by` | uuid FK -> profiles | |
| `content` | text NOT NULL | Rich text with @mentions |
| `mentions` | jsonb | |
| `inline_images` | jsonb | |
| `created_at` | timestamptz | |

## Migration

**File:** `supabase/migrations/022_hub_todos.sql`

### Indexes

- `hub_id` on lists, items, and comments
- `list_id` on items
- `item_id` on assignees and comments
- `due_date` on items
- `position` on lists and items

### RLS Policies

Follow the 016 `hub_folders`/`hub_files` pattern:

**Lists, Items, Comments (SELECT):**
```sql
exists (select 1 from public.hub_members hm
  where hm.hub_id = <table>.hub_id and hm.profile_id = auth.uid())
or exists (select 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'Admin')
```

**Lists, Items, Comments (INSERT):**
```sql
created_by = auth.uid()
and exists (select 1 from public.hub_members hm
  where hm.hub_id = <table>.hub_id and hm.profile_id = auth.uid())
```

**Lists, Items (UPDATE):**
```sql
created_by = auth.uid()
or exists (select 1 from public.hub_members hm
  where hm.hub_id = <table>.hub_id and hm.profile_id = auth.uid()
  and hm.role in ('owner', 'admin'))
or exists (select 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'Admin')
```

**Lists, Items, Comments (DELETE):** Same as UPDATE.

**Assignees (INSERT):**
```sql
exists (select 1 from public.hub_members hm
  where hm.hub_id = (select hub_id from public.hub_todo_items where id = hub_todo_item_assignees.item_id)
  and hm.profile_id = auth.uid())
```

**Assignees (DELETE):**
```sql
-- Item creator, hub admin/owner, or global Admin
exists (select 1 from public.hub_todo_items i
  where i.id = hub_todo_item_assignees.item_id and i.created_by = auth.uid())
or exists (select 1 from public.hub_todo_items i
  join public.hub_members hm on hm.hub_id = i.hub_id
  where i.id = hub_todo_item_assignees.item_id
  and hm.profile_id = auth.uid() and hm.role in ('owner', 'admin'))
or exists (select 1 from public.profiles p
  where p.id = auth.uid() and p.role = 'Admin')
```

### `updated_at` Trigger

Reuse the auto-update pattern — `before update` trigger sets `updated_at = now()` on `hub_todo_lists` and `hub_todo_items`.

### Activity Trigger

```sql
create or replace function public.hub_activity_on_todo()
returns trigger language plpgsql security definer as $$
declare
  actor_name text;
  item_hub uuid;
  hub_team uuid;
begin
  select full_name into actor_name from public.profiles where id = new.created_by;
  item_hub := new.hub_id;
  select team_id into hub_team from public.hubs where id = item_hub;
  insert into public.hub_activity (team_id, hub_id, actor_id, event_type, entity_type, entity_id, summary)
  values (
    hub_team, item_hub, new.created_by,
    'todo_added', 'todo', new.id,
    coalesce(actor_name, 'Someone') || ' added a to-do: ' || left(new.title, 80)
  );
  return new;
end;
$$;

create trigger trg_hub_activity_todo
  after insert on public.hub_todo_items
  for each row execute function public.hub_activity_on_todo();
```

### Realtime

```sql
alter publication supabase_realtime add table public.hub_todo_lists;
alter publication supabase_realtime add table public.hub_todo_items;
alter publication supabase_realtime add table public.hub_todo_item_assignees;
alter publication supabase_realtime add table public.hub_todo_comments;
```

## Hooks

### `useHubTodos(hubId)`

Single hook managing all lists and items for a hub.

**State:** `lists`, `items`, `loading`

**Fetch pattern** (following `useHubCheckIns`):
```js
const [{ data: listData }, { data: itemData }] = await Promise.all([
  supabase.from('hub_todo_lists')
    .select('*, creator:profiles!hub_todo_lists_created_by_fkey(id, full_name, avatar_url)')
    .eq('hub_id', hubRef.current)
    .order('position'),
  supabase.from('hub_todo_items')
    .select('*, creator:profiles!hub_todo_items_created_by_fkey(id, full_name, avatar_url), completer:profiles!hub_todo_items_completed_by_fkey(id, full_name), hub_todo_item_assignees(profile_id, profiles(id, full_name, avatar_url))')
    .eq('hub_id', hubRef.current)
    .order('position')
])
```

**Client-side enrichment:** Each list gets `items` (filtered from the items array by `list_id`), `totalItems`, and `completedItems` counts.

**Realtime:** Single channel `hub-todos-${hubId}` with two listeners on `hub_todo_lists` and `hub_todo_items`, both filtered by `hub_id`, both trigger full refetch.

**List mutations:**
- `createList(title, description)` — inserts with `position` = current list count
- `updateList(id, { title, description })` — updates by id
- `deleteList(id)` — deletes by id (cascades items)
- `reorderLists(orderedIds)` — maps each id to index, updates position per row

**Item mutations:**
- `createItem(listId, title)` — inserts with `position` = current item count in that list, minimal fields for fast creation
- `toggleItem(id, currentState)` — updates `completed`, `completed_at`, `completed_by`
- `updateItem(id, { title, notes, dueDate, mentions, inlineImages })` — updates by id, handles `hub_mentions` insertion for @mentions
- `deleteItem(id)` — cleans up `hub_mentions` then deletes
- `reorderItems(orderedIds)` — same pattern as `reorderLists`
- `setAssignees(itemId, profileIds)` — deletes existing assignee rows, inserts new ones

**Returns:** `{ lists, items, loading, createList, updateList, deleteList, reorderLists, createItem, toggleItem, updateItem, deleteItem, reorderItems, setAssignees }`

### `useHubTodoComments(itemId)`

Instantiated only when a to-do detail view is open.

**State:** `comments`, `loading`

**Fetch:** Comments with author profile join, ordered by `created_at asc`.

**Realtime:** Channel `hub-todo-comments-${itemId}` on `hub_todo_comments` filtered by `item_id`.

**Mutations:**
- `addComment(content, mentions, inlineImages)` — inserts comment, handles `hub_mentions`
- `deleteComment(id)` — cleans up `hub_mentions` then deletes

**Returns:** `{ comments, loading, addComment, deleteComment }`

## Components

### Module Registration (`HubPage.jsx`)

```js
// MODULE_DEFS
'to-dos': { title: 'To-Dos', icon: CheckSquare, color: '#8b5cf6', defaultOpen: true }

// MODULE_COMPONENTS
'to-dos': Todos
```

Add `'to-dos'` to `DEFAULT_LEFT_ORDER` in `useHubModuleOrder.js`, after `'message-board'`.

### Component Tree

```
Todos (hubId)                         -- module entry point, calls useHubTodos(hubId)
+-- TodoListCreate                    -- inline form: title input + create button
+-- TodoList (xN, one per list)       -- collapsible card per list
|   +-- Header                        -- title, progress bar, edit/delete, hide-completed toggle
|   +-- DndContext (@dnd-kit)          -- wraps sortable item list
|   |   +-- TodoItem (xN)             -- individual to-do row
|   |       +-- Drag handle           -- grip icon for reordering
|   |       +-- Checkbox              -- toggle completion
|   |       +-- Title + due badge     -- struck-through + faded when done, red/orange badge if overdue
|   |       +-- Assignee avatars      -- small avatar stack (max 3 + overflow count)
|   |       +-- Expand button         -- opens detail view
|   +-- TodoItemCreate                -- inline input at bottom: type title, press Enter
+-- TodoItemDetail (SlidePanel)       -- opened when clicking into an item
    +-- Title (editable)
    +-- Notes (RichInput)             -- @mentions + inline images
    +-- Assignees picker              -- multi-select from hub members via useHubMembers
    +-- Due date picker               -- date input
    +-- Completion status             -- who completed + when
    +-- Comments thread               -- useHubTodoComments, RichInput for new comment
```

### UI Behavior

- **Progress indicator:** Progress bar at top of each list showing `completedItems / totalItems`. When all items complete, list header gets a checkmark badge and muted styling.
- **Completed items:** Stay in-place, faded opacity + struck-through title. Per-list "Hide completed" toggle collapses them.
- **Overdue highlighting:** Items past due date get a red badge. Items due today get an orange badge. Simple date comparison, not the priority engine.
- **Inline creation:** `TodoItemCreate` is a single text input at the bottom of each list. Type title, press Enter. Assignment, notes, and due date are set via the detail view.
- **Detail view:** `SlidePanel` (existing animation component). Opens from the right. Contains editable fields, assignee picker, and comments thread.
- **Drag-and-drop:** Items within a list are drag-sortable via @dnd-kit. Lists are not drag-sorted (ordered by creation/position).
- **Empty state:** When a hub has no to-do lists, show a centered prompt: "No to-do lists yet" with a "New list" button.

## Mentions Integration

- **Item notes:** `RichInput` with @mention autocomplete. `mentions` JSONB stored on `hub_todo_items`. On save, insert into `hub_mentions` with `entity_type: 'todo_note'`.
- **Comments:** `RichInput` with @mention autocomplete. `mentions` JSONB stored on `hub_todo_comments`. On save, insert into `hub_mentions` with `entity_type: 'todo_comment'`.
- **Rendering:** `RichContentRenderer` for notes and comments (highlighted @mention spans, inline images with signed URLs).
- **Notifications:** `hub_mentions` rows trigger the existing `hub-mention-notify` edge function for email. `useMentionNotifications` picks them up for in-app NotificationBell.

## Activity Feed

- INSERT on `hub_todo_items` fires `hub_activity_on_todo()` trigger
- Writes to `hub_activity` with `event_type: 'todo_added'`, `entity_type: 'todo'`
- Summary: `"<name> added a to-do: <title>"`
- No activity for completion toggles or comments (too noisy)

## Out of Scope

- **To-do list templates** — Reusable list templates for recurring workflows
- **Hill Charts** — Basecamp's progress visualization beyond the progress bar
- **To-do groups** — Sub-headings within lists (3-level hierarchy)
- **Assignment/completion email notifications** — Beyond @mentions, no dedicated "you were assigned" or "to-do completed" emails
- **Priority engine integration** — To-dos use simple overdue date comparison, not the task priority engine
- **Cross-hub to-do views** — No "all my to-dos across all hubs" page
