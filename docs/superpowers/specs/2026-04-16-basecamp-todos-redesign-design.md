# Basecamp-Style To-Dos Redesign

**Date:** 2026-04-16
**Scope:** Hub To-Dos module
**Supersedes UX decisions in:** `2026-04-15-hub-todos-design.md`
**Does not supersede:** the 022 schema (builds on it via a new 023 migration)

## Goal

Replace the current inline-accordion to-do UI with a Basecamp-faithful experience: dedicated pages per list and per item, rich list/item notes with attachments, per-item subscribers, soft-delete with undo, list colors, and activity-feed integration.

## Non-goals (deferred)

- "View as…" grouping (by assignee, by due date)
- List templates / "Use a to-do list template…"
- Hill Chart tracking
- Full WYSIWYG editor (Tiptap/Lexical)
- "Empty trash" UI and the cron that hard-deletes soft-deleted rows
- "When done, notify" as a separate concept from assignees — completion notifications go to assignees + subscribers only

## Architecture

### Navigation model

Today `Todos.jsx` is a single module card in the hub's drag-sortable grid, rendering every list expanded inline. That becomes a compact preview, and real work moves to dedicated routes.

| Route | Purpose |
|---|---|
| `/hub/:hubId` (module card) | Compact preview: up to 5 lists with title + progress + row-click → list page. Header has `Open →` link to the index. |
| `/hub/:hubId/todos` | **Index** — header `To-dos`, `+ New list` pill top-left, `…` menu top-right. List cards with color dot, title, description preview, progress. Inline-expanded "new list" form on click. |
| `/hub/:hubId/todos/:listId` | **List page** — breadcrumb `Hub › To-dos › <list>`, list title + color dot + description, `X/Y completed`, items with inline `+ Add a to-do` at top. |
| `/hub/:hubId/todos/:listId/items/:itemId` | **Item page** — breadcrumb, checkbox + title, assignees, due date, notes, comments (always visible), subscribers block at the bottom. |

`App.jsx` gets a single new route entry `/hub/:hubId/todos/*` that mounts `HubTodosPage`, which owns the nested routes internally. The existing `/hub/:hubId` route is unchanged.

### Component layout

```
src/pages/
  HubTodosPage.jsx              routes wrapper; owns useHubTodos(hubId)

src/components/hub/todos/
  TodosModuleCard.jsx           compact preview shown inside the hub module grid
  TodosIndex.jsx                /hub/:hubId/todos
  TodoListPage.jsx              /hub/:hubId/todos/:listId
  TodoItemPage.jsx              /hub/:hubId/todos/:listId/items/:itemId
  NewListForm.jsx               expanded "Name this list…" card (matches screenshots 1-2)
  NewItemForm.jsx               expanded new-item card (matches screenshot 3)
  TodoListRow.jsx               list card on the index
  TodoItemRow.jsx               row inside a list page; replaces old TodoItem.jsx
  TodoBreadcrumb.jsx            shared breadcrumb
  TodoSubscribers.jsx           subscribers block on item page
  TrashedToast.jsx              "… is in the trash — Undo" toast
  RichTextField.jsx             RichInput + toolbar (bold, italic, link, bullet, number, attach)

src/hooks/
  useHubTodos.js                EXTEND: color, soft-delete, attachments, undo
  useHubTodoComments.js         EXTEND: auto-subscribe commenter on insert
  useHubTodoSubscribers.js      NEW
  useHubTodoAttachments.js      NEW (uploads to hub-todo-attachments bucket)
```

**Deleted:** `src/components/hub/Todos.jsx`, `TodoItem.jsx`, `TodoItemDetail.jsx`.

### State

`HubTodosPage` owns the single `useHubTodos(hubId)` call and passes data to children via props. No new React Context — fits the codebase's "no global state" convention.

## Data model (migration `023_hub_todos_v2.sql`)

### `hub_todo_lists` — new columns

- `color text not null default 'blue'` — one of `blue | green | red | yellow | purple | orange | gray` (enforced by `CHECK`). Stored as short tokens so the UI owns the palette.
- `deleted_at timestamptz` — soft delete. `NULL` = active. All SELECT queries and RLS filter `deleted_at IS NULL`. No hard-delete cron in v1.
- `attachments jsonb not null default '[]'::jsonb` — shape `[{path, name, size, mime}]`.

### `hub_todo_items` — new columns

- `deleted_at timestamptz` — soft delete.
- `attachments jsonb not null default '[]'::jsonb` — same shape as above.

### `hub_todo_item_subscribers` — new table

```sql
create table public.hub_todo_item_subscribers (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references hub_todo_items(id) on delete cascade,
  profile_id uuid not null references profiles(id)       on delete cascade,
  created_at timestamptz not null default now(),
  unique (item_id, profile_id)
);

create index idx_hub_todo_subscribers_item    on hub_todo_item_subscribers(item_id);
create index idx_hub_todo_subscribers_profile on hub_todo_item_subscribers(profile_id);

alter table public.hub_todo_item_subscribers enable row level security;
```

RLS mirrors `hub_todo_item_assignees` exactly (select/insert/delete gated by hub membership via `hub_todo_items.hub_id`).

### Auto-subscribe triggers

All three use `on conflict (item_id, profile_id) do nothing` so they are idempotent and safe under realtime replays.

1. **On item insert** — subscribe `new.created_by`.
2. **On assignee insert** — subscribe `new.profile_id` for the assignee's item.
3. **On comment insert** — subscribe `new.created_by` for the item.

### Storage bucket

`hub-todo-attachments`:
- Private (auth-required signed URLs).
- 10 MB per-file limit.
- Storage RLS mirrors `task-attachments`: members of the owning hub can read; uploader is the row's `created_by`; delete gated the same way.

### Activity feed

Three new `hub_activity.event_type` values, via triggers:

- `todo_list_created` — after insert on `hub_todo_lists`.
- `todo_item_completed` — after update on `hub_todo_items` where `completed` flipped `false → true`.
- `todo_item_assigned` — after insert on `hub_todo_item_assignees`.

Existing `trg_hub_activity_todo` ("added a to-do") stays; new triggers are additive.

### Mentions

`hub_mentions.entity_type` gains `'todo_comment'` alongside the existing `'todo_note'`. The `hub-mention-notify` edge function already resolves entity types generically; no code change needed beyond the new enum literal.

## UX behaviours

### List creation (screenshots 1–2)

- `+ New list` on the index expands an inline card with title input focused.
- Title is a single line, auto-grows; description is a `RichTextField` with full toolbar.
- Escape or Cancel discards; `Add this list` is disabled while title is empty.
- Submit is optimistic; realtime delivers the row to everyone else.

### Item creation (screenshot 3)

- On the list page, a persistent `+ Add a to-do` row sits at the top of the item area.
- Click expands into the full form: title, assignees typeahead, due date, notes (`RichTextField`).
- `Add this to-do` submits; `Cancel` collapses.

### Completion

- Checkboxes work from every surface (preview card, list page, item page).
- Completion sends an email to **assignees + subscribers** (minus the user who clicked). A new edge-function event `todo_completed` reuses `hub-mention-notify`'s Resend setup.
- Visual: strike-through + grey text; list progress bar updates in place.

### Soft-delete + undo

- Delete sets `deleted_at = now()`. UI hides trashed rows immediately.
- `TrashedToast` shows "The to-do list is in the trash — Undo" for 30 seconds. Clicking Undo sets `deleted_at = null`.
- After 30s the toast dismisses; the row stays soft-deleted. No "Empty trash" UI in v1.

### Subscribers block (item page)

- Header: `Subscribers` + `N people will be notified when someone comments.`
- Avatar stack + `Add/remove people…` (opens a multi-select modal of hub members).
- Below: `You're subscribed` with `Unsubscribe me`, or `You're not subscribed` with `Subscribe me`.
- Auto-subscribe via triggers on item creation (creator), assignee added (that profile), and comment posted (commenter).

### Comments

- Same `RichInput` as today (@mentions + inline images). **No** toolbar — the toolbar is reserved for the richer note fields.
- Posting notifies every subscriber via the same `todo_comment_posted` edge-function event (new).
- @mentions continue to create `hub_mentions` rows, which drive in-app notifications and email via `hub-mention-notify`.
- **Email dedup rule:** for `todo_comment` mentions, `hub-mention-notify` skips users who are already subscribers to the item — they get exactly one email from `hub-todo-notify` instead of two. In-app mention notifications are never suppressed.

### Attachments in notes

- `RichTextField`'s attach button opens a file picker → uploads to `hub-todo-attachments` → inserts a chip `{type:'attachment', path, name, size, mime}` into the field.
- `RichContentRenderer` grows an `attachments` renderer: mime-icon + name + signed download link.
- Pasted inline images keep using `inline_images` — unchanged.

### Breadcrumb

Clickable segments (`Hub name` → hub page, `To-dos` → index, `List name` → list page). Final segment is plain text, not a link.

### Color palette

Seven tokens map to Tailwind classes in a single `TODO_LIST_COLORS` constant:

```
blue   → bg-brand-500    (default)
green  → bg-green-500
red    → bg-red-500
yellow → bg-yellow-500
purple → bg-purple-500
orange → bg-orange-500
gray   → bg-slate-400
```

Rendered as a small solid dot (currently `●` in screenshots) alongside list titles wherever a list is shown.

## Edge functions

One new edge function, `hub-todo-notify`, modeled on `hub-mention-notify`:

- Triggered by DB webhook on two events:
  - `hub_todo_items` update where `completed` flipped `false → true` → `event=todo_completed`.
  - `hub_todo_comments` insert → `event=todo_comment_posted`.
- Resolves subscribers (`hub_todo_item_subscribers` + assignees for completions), excludes the acting user, and sends Resend emails with a link to the item page.

## RLS summary

New / changed policies:

- `hub_todo_lists_select`, `_update`, `_delete` — add `deleted_at IS NULL` to the `select` policy's visibility predicate. Update policy still allows setting `deleted_at` (that's how delete works).
- Same pattern on `hub_todo_items`.
- `hub_todo_item_subscribers_{select,insert,delete}` — mirror `hub_todo_item_assignees`.
- `hub-todo-attachments` bucket policies — mirror `task-attachments`.

## Testing

New Vitest suites in `src/lib/__tests__/`:

- `todoColors.test.js` — palette mapping and default fallback.
- Subscriber auto-subscribe behaviour is covered by DB-level integration (no unit test).

Existing tests (`priority`, `assignmentType`, `helpers`, `filters`, `acceptance`) are untouched.

## Rollout

Single merge. No feature flag. Existing 022 data migrates seamlessly:
- `color` defaults to `blue`.
- `deleted_at` defaults to `NULL`.
- `attachments` defaults to `[]`.
- Existing items get subscribers entries backfilled in the migration: one row per `(item_id, created_by)` and one per `(item_id, profile_id)` for each assignee.

## File count estimate

| Change | Count |
|---|---|
| New components | 12 |
| New hooks | 2 |
| Deleted components | 3 |
| New migration | 1 |
| New edge function | 1 |
| Modified files | `App.jsx`, `HubPage.jsx`, `RichContentRenderer.jsx`, `useHubTodos.js`, `useHubTodoComments.js` |

Each new file is expected to be under 200 lines.
