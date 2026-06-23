# Task Archive + Bulk Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a non-destructive, per-user **Archive** action (bulk + single-row) to tasks, plus an **Archived** tab on My Tasks to browse / restore / permanently delete archived tasks. Bulk multi-select already exists; this adds the archive half.

**Architecture:** Personal archive via a new `task_archives(user_id, task_id)` junction table with `user_id = auth.uid()` RLS. `useTasks.fetchTasks` tags each enriched task with a boolean `archived`. Active lists filter `!archived`; the Archived tab filters `archived`. No change to the `tasks` table or its RLS.

**Tech Stack:** React 18 + Vite, Supabase (Postgres + RLS), Vitest, Tailwind, lucide-react, framer-motion.

**Deployment note:** Migration `105` must be applied to the Supabase project (dashboard SQL editor or CLI) before the UI works — until then `task_archives` selects return an error that `fetchTasks` swallows (archived set stays empty, feature silently inert). No cron/edge-function/webhook-secret concerns (pure table + RLS).

---

### Task 1: Migration — `task_archives` table + RLS

**Files:**
- Create: `supabase/migrations/105_task_archives.sql`

**Step 1: Write the migration**

```sql
-- 105_task_archives.sql
-- Personal, per-viewer task archive. Archiving a task hides it only from the
-- archiving user's lists; collaborators (assigner, other assignees, managers)
-- still see it active. This is a side-table by design: it never writes to
-- `tasks`, so it can't trip the 042 self-update guard, sync_effective_role, or
-- any task-visibility predicate. Unarchive = delete the row.

create table if not exists public.task_archives (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  task_id     uuid not null references public.tasks(id)    on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

alter table public.task_archives enable row level security;

-- Every policy is scoped to the caller's own rows. No manager/admin escalation:
-- archive is purely personal, so there is nothing cross-user to read or write.
create policy "task_archives_select" on public.task_archives
  for select using (user_id = auth.uid());

create policy "task_archives_insert" on public.task_archives
  for insert with check (user_id = auth.uid());

create policy "task_archives_delete" on public.task_archives
  for delete using (user_id = auth.uid());
```

**Step 2: Commit**

```bash
git add supabase/migrations/105_task_archives.sql
git commit -m "feat(tasks): add task_archives table + per-user RLS (migration 105)"
```

---

### Task 2: Pure helper `splitByArchived` (TDD)

**Files:**
- Create: `src/lib/archive.js`
- Test: `src/lib/__tests__/archive.test.js`

**Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest'
import { splitByArchived } from '../archive'

describe('splitByArchived', () => {
  it('partitions tasks by the archived flag', () => {
    const tasks = [
      { id: 'a', archived: false },
      { id: 'b', archived: true },
      { id: 'c' },               // missing flag → active
      { id: 'd', archived: true },
    ]
    const { active, archived } = splitByArchived(tasks)
    expect(active.map(t => t.id)).toEqual(['a', 'c'])
    expect(archived.map(t => t.id)).toEqual(['b', 'd'])
  })

  it('preserves input order within each partition', () => {
    const tasks = [
      { id: '1', archived: true },
      { id: '2', archived: false },
      { id: '3', archived: true },
    ]
    const { active, archived } = splitByArchived(tasks)
    expect(archived.map(t => t.id)).toEqual(['1', '3'])
    expect(active.map(t => t.id)).toEqual(['2'])
  })

  it('handles null / undefined / empty input', () => {
    expect(splitByArchived(null)).toEqual({ active: [], archived: [] })
    expect(splitByArchived(undefined)).toEqual({ active: [], archived: [] })
    expect(splitByArchived([])).toEqual({ active: [], archived: [] })
  })

  it('does not mutate the input array', () => {
    const tasks = [{ id: 'a', archived: true }]
    const copy = [...tasks]
    splitByArchived(tasks)
    expect(tasks).toEqual(copy)
  })
})
```

**Step 2: Run to verify it fails**

Run: `npm test -- src/lib/__tests__/archive.test.js`
Expected: FAIL — "Failed to resolve import '../archive'".

**Step 3: Write minimal implementation**

```js
// src/lib/archive.js
// Pure helpers for the personal task-archive feature. Archive state is a
// per-user junction (task_archives); useTasks.fetchTasks tags each enriched
// task with a boolean `archived`. Keeping the active/archived split here (out
// of the page components) makes it unit-testable.

export function splitByArchived(tasks) {
  const active = []
  const archived = []
  for (const t of tasks || []) {
    if (t && t.archived) archived.push(t)
    else active.push(t)
  }
  return { active, archived }
}
```

**Step 4: Run to verify it passes**

Run: `npm test -- src/lib/__tests__/archive.test.js`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/lib/archive.js src/lib/__tests__/archive.test.js
git commit -m "feat(tasks): splitByArchived pure helper + tests"
```

---

### Task 3: Data layer — enrich `archived` + archive/unarchive actions

**Files:**
- Modify: `src/hooks/useTasks.jsx`

**Step 1: Fetch the personal archive set in `fetchTasks`**

After the unread-counts block (around line 181, before `const subtaskCounts = ...`), insert:

```js
    // Personal archive set (migration 105). task_archives is per-user; RLS
    // already scopes rows to the caller, so no user_id filter is needed. Tag
    // tasks below so active lists can drop archived rows and the Archived tab
    // can keep them. A failure here degrades gracefully (set stays empty →
    // nothing looks archived) rather than breaking the whole task fetch.
    const archivedSet = new Set()
    {
      const { data: archRows, error: archErr } = await supabase
        .from('task_archives')
        .select('task_id')
      if (archErr) console.warn('task_archives fetch failed:', archErr.message)
      else for (const r of archRows || []) archivedSet.add(r.task_id)
    }
```

**Step 2: Tag each enriched task**

In the `enriched` map's returned object (around line 198-207), add one field:

```js
        assignees,
        archived:      archivedSet.has(t.id),
```

**Step 3: Make archived changes survive the surgical merge**

In the `sameMeta` comparison (around line 230-248), add a line so toggling archived forces a new object identity (otherwise the row won't move in/out of view):

```js
          a.archived === b.archived &&
```

(Add it alongside the other `a.x === b.x` comparisons, e.g. right after `a.priority === b.priority &&`.)

**Step 4: Add `archiveTasks` / `unarchiveTasks` to `useTaskActions`**

After `updateTasks` (line 772), before `addAssignee`:

```js
  async function archiveTasks(taskIds) {
    if (!profile?.id || !taskIds?.length) return { ok: true }
    const rows = taskIds.map(id => ({ user_id: profile.id, task_id: id }))
    // Idempotent: re-archiving an already-archived task is a no-op (composite
    // PK + ignoreDuplicates), so bulk-archiving a mixed selection is safe.
    const { error } = await supabase
      .from('task_archives')
      .upsert(rows, { onConflict: 'user_id,task_id', ignoreDuplicates: true })
    if (error) return { ok: false, msg: error.message }
    return { ok: true }
  }

  async function unarchiveTasks(taskIds) {
    if (!profile?.id || !taskIds?.length) return { ok: true }
    const { error } = await supabase
      .from('task_archives')
      .delete()
      .eq('user_id', profile.id)
      .in('task_id', taskIds)
    if (error) return { ok: false, msg: error.message }
    return { ok: true }
  }
```

**Step 5: Export the new actions**

Update the return (line 793):

```js
  return { assignTask, updateTask, addComment, getTaskComments, acceptTask, declineTask, reassignTask, deleteTask, deleteTasks, updateTasks, archiveTasks, unarchiveTasks, addAssignee, removeAssignee }
```

**Step 6: Verify build**

Run: `npm run build`
Expected: succeeds.

**Step 7: Commit**

```bash
git add src/hooks/useTasks.jsx
git commit -m "feat(tasks): enrich tasks with archived flag + archiveTasks/unarchiveTasks actions"
```

---

### Task 4: `MassActionBar` — `mode` prop + Archive / Unarchive buttons

**Files:**
- Modify: `src/components/tasks/MassActionBar.jsx`

**Step 1: Replace the component**

```jsx
import { motion, AnimatePresence } from 'framer-motion'
import { Trash2, Archive, ArchiveRestore } from 'lucide-react'

export default function MassActionBar({
  selectedCount, onSelectAll, onDeselectAll,
  onBulkStatusChange, onBulkUrgencyChange, onBulkDelete,
  mode = 'active', onBulkArchive, onBulkUnarchive,
}) {
  const archived = mode === 'archived'
  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="rounded-xl border bg-brand-50/50 border-brand-200 dark:bg-brand-500/5 dark:border-brand-500/20 px-4 py-3 flex flex-wrap items-center gap-3 mb-3">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {selectedCount} task{selectedCount !== 1 ? 's' : ''} selected
            </span>

            <button onClick={onSelectAll} className="btn-ghost text-xs px-2 py-1">Select All</button>
            <button onClick={onDeselectAll} className="btn-ghost text-xs px-2 py-1">Deselect All</button>

            <div className="border-l border-slate-300 dark:border-dark-border h-5" />

            {!archived && (
              <>
                <select
                  defaultValue=""
                  onChange={e => { if (e.target.value) { onBulkStatusChange(e.target.value); e.target.value = '' } }}
                  className="form-input text-xs py-1.5 px-2 w-auto"
                >
                  <option value="" disabled>Change status...</option>
                  <option value="Not Started">Not Started</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Blocked">Blocked</option>
                  <option value="Done">Done</option>
                </select>

                <select
                  defaultValue=""
                  onChange={e => { if (e.target.value) { onBulkUrgencyChange(e.target.value); e.target.value = '' } }}
                  className="form-input text-xs py-1.5 px-2 w-auto"
                >
                  <option value="" disabled>Change urgency...</option>
                  <option value="High">High</option>
                  <option value="Med">Med</option>
                  <option value="Low">Low</option>
                </select>

                <button onClick={onBulkArchive} className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5">
                  <Archive size={13} /> Archive
                </button>
              </>
            )}

            {archived && (
              <button onClick={onBulkUnarchive} className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5">
                <ArchiveRestore size={13} /> Unarchive
              </button>
            )}

            <button onClick={onBulkDelete} className="btn-danger text-xs px-3 py-1.5 flex items-center gap-1.5">
              <Trash2 size={13} /> {archived ? 'Delete forever' : 'Delete'}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: succeeds.

**Step 3: Commit**

```bash
git add src/components/tasks/MassActionBar.jsx
git commit -m "feat(tasks): MassActionBar mode prop with Archive/Unarchive actions"
```

---

### Task 5: My Tasks — Archived tab + archive filtering + handlers

**Files:**
- Modify: `src/pages/MyTasksPage.jsx`

**Step 1: Import the helper + new actions**

- Add import: `import { splitByArchived } from '../lib/archive'`
- Destructure (line 33): add `archiveTasks, unarchiveTasks` →
  `const { acceptTask, declineTask, deleteTasks, updateTasks, updateTask, deleteTask, assignTask, archiveTasks, unarchiveTasks } = useTaskActions()`

**Step 2: Allow the `archived` tab value**

In the `useState` tab initializer (line 42), accept `archived`:
```js
return (t === 'assigned' || t === 'recurring' || t === 'archived') ? t : 'mine'
```

**Step 3: Derive active/archived sources via the helper** (replace lines 77-79)

```js
  // Tasks I assigned to others (exclude self-assignments)
  const assignedByMe = tasks.filter(t => t.assigned_by === profile?.id && t.assigned_to !== profile?.id)

  // Archive split (migration 105). Active tabs exclude tasks I archived; the
  // Archived tab is the universal personal bin across every source list.
  const archivedTasks  = splitByArchived(tasks).archived
  const activeMine     = splitByArchived(myTasks).active
  const activeAssigned = splitByArchived(assignedByMe).active
  const activeTasks =
    tab === 'archived' ? archivedTasks
    : tab === 'mine'   ? activeMine
    :                    activeAssigned
```

**Step 4: Force list view on the archived tab**

After `const activeTasks = ...`, add:
```js
  // The Archived tab is a flat bin — the kanban board is meaningless there.
  const boardView = view === 'board' && tab !== 'archived'
```
Then replace every `view === 'board'` used for rendering logic with `boardView`:
- `effectiveFilters` (line 169)
- `stats` top ternary (line 178)
- the render branch `{view === 'board' ? (` (line 358)

**Step 5: Archived-tab stats branch**

In the `stats` ternary, add an archived branch BEFORE the `tab === 'mine'` check:
```js
  const stats = boardView
    ? [ /* unchanged board stats */ ]
    : tab === 'archived'
      ? [
          { label: 'Archived',  value: filtered.length, color: 'text-slate-500' },
          { label: 'Completed', value: filtered.filter(t => t.status === 'Done').length, color: 'text-emerald-600' },
          { label: 'Open',      value: filtered.filter(t => t.status !== 'Done').length, color: 'text-slate-900 dark:text-white' },
        ]
    : tab === 'mine'
      ? [ /* unchanged */ ]
      : [ /* unchanged */ ]
```

**Step 6: Bulk archive / unarchive handlers**

After `handleBulkDelete` (line 245), add:
```js
  async function handleBulkArchive() {
    const n = selectedIds.size
    const result = await archiveTasks([...selectedIds])
    if (result.ok) { showToast(`${n} task(s) archived`); setSelectedIds(new Set()); refetch(true) }
    else showToast(result.msg, 'error')
  }

  async function handleBulkUnarchive() {
    const n = selectedIds.size
    const result = await unarchiveTasks([...selectedIds])
    if (result.ok) { showToast(`${n} task(s) restored`); setSelectedIds(new Set()); refetch(true) }
    else showToast(result.msg, 'error')
  }
```

**Step 7: Add the Archived tab button** (after the Recurring tab block, line 344)

```jsx
            <button
              onClick={() => setTab('archived')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                tab === 'archived'
                  ? 'bg-white dark:bg-dark-card text-slate-900 dark:text-white shadow-soft'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              Archived
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-md ${
                tab === 'archived'
                  ? 'bg-slate-200 text-slate-600 dark:bg-dark-border dark:text-slate-300'
                  : 'bg-slate-200/60 text-slate-500 dark:bg-dark-border dark:text-slate-400'
              }`}>
                {archivedTasks.length}
              </span>
            </button>
```

**Step 8: Update the two active-tab count badges**

- Mine badge (line 306): `{myTasks.length}` → `{activeMine.length}`
- Assigned badge (line 323): `{assignedByMe.length}` → `{activeAssigned.length}`

**Step 9: Wire MassActionBar mode + new callbacks** (replace lines 435-442)

```jsx
              <MassActionBar
                selectedCount={filtered.filter(t => selectedIds.has(t.id)).length}
                onSelectAll={() => setSelectedIds(new Set(filtered.map(t => t.id)))}
                onDeselectAll={() => setSelectedIds(new Set())}
                mode={tab === 'archived' ? 'archived' : 'active'}
                onBulkStatusChange={handleBulkStatusChange}
                onBulkUrgencyChange={handleBulkUrgencyChange}
                onBulkArchive={handleBulkArchive}
                onBulkUnarchive={handleBulkUnarchive}
                onBulkDelete={() => setShowBulkDelete(true)}
              />
```

**Step 10: Archived empty state + table flags**

In the `filtered.length === 0` ternary (lines 443-462):
- Empty state: when `tab === 'archived'`, icon `🗄️`, title "Nothing archived", description "Tasks you archive show up here. Archived tasks are hidden from your other lists."
- `TaskTable`: when `tab === 'archived'`, set `showAcceptanceActions={false}`, `showAssignedBy`, `showAssignedTo` both truthy so the mixed bin reads clearly. (Acceptance actions stay gated to `tab === 'mine'`.)

**Step 11: Verify build + tests**

Run: `npm run build && npm run test:run`
Expected: build succeeds; all tests pass (incl. new archive.test.js).

**Step 12: Commit**

```bash
git add src/pages/MyTasksPage.jsx
git commit -m "feat(tasks): Archived tab on My Tasks with bulk archive/unarchive"
```

---

### Task 6: Hide archived rows + Archive bulk action on Team View & Admin Overview

**Files:**
- Modify: `src/pages/TeamViewPage.jsx`
- Modify: `src/pages/AdminOverviewPage.jsx`

For EACH page:

**Step 1:** Import `splitByArchived` from `../lib/archive`; destructure `archiveTasks` from `useTaskActions()`.

**Step 2:** Exclude archived from the page's task source — apply `splitByArchived(<source>).active` (or `.filter(t => !t.archived)`) at the point where the page derives the list it feeds into `applyFilters`. A task you archived must not reappear here.

**Step 3:** Add a `handleBulkArchive` mirroring My Tasks (archiveTasks + toast + clear selection + refetch).

**Step 4:** On the `MassActionBar`, pass `mode="active"` (default — can omit) and `onBulkArchive={handleBulkArchive}`. (No Archived tab here — the bin lives on My Tasks.) On TeamViewPage keep the existing `selectable={isAdmin}` gating.

**Step 5: Verify build**

Run: `npm run build`
Expected: succeeds.

**Step 6: Commit**

```bash
git add src/pages/TeamViewPage.jsx src/pages/AdminOverviewPage.jsx
git commit -m "feat(tasks): hide archived rows + Archive bulk action on Team/Admin views"
```

---

### Task 7: Single-row Archive / Unarchive in `TaskDetailPanel`

**Files:**
- Modify: `src/components/tasks/TaskDetailPanel.jsx`

**Step 1:** Read the file; locate the action area (where Delete / Reassign / status controls live) and how it gets `useTaskActions` + a refetch/`onUpdated` callback.

**Step 2:** Destructure `archiveTasks, unarchiveTasks` from `useTaskActions()`. Add an **Archive** button when `!task.archived` and an **Unarchive** button when `task.archived`, calling `archiveTasks([task.id])` / `unarchiveTasks([task.id])`, then on success show a toast and call the panel's existing refresh (`onUpdated?.()` / `refetch`). Use the lucide `Archive` / `ArchiveRestore` icons, styled to match the panel's existing secondary actions.

**Step 3: Verify build**

Run: `npm run build`
Expected: succeeds.

**Step 4: Commit**

```bash
git add src/components/tasks/TaskDetailPanel.jsx
git commit -m "feat(tasks): single-row Archive/Unarchive in task detail panel"
```

---

### Task 8: Final verification

**Step 1:** `npm run test:run` — all pass.
**Step 2:** `npm run build` — clean.
**Step 3:** Manual smoke (document, can't headless-OAuth): archive from bulk bar → row leaves active list → appears in Archived tab → unarchive → returns → delete forever removes it. Confirm a teammate still sees an archived-by-me task as active (personal scope).
**Step 4:** Update the design doc status to "Implemented"; update the vault.
