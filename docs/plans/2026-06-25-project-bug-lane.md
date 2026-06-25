# Project Bug Lane Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a third lane ("Bugs") to the project detail page for reporting and triaging bugs — a lightweight `bugs` record, promotable into a real fix task, mirroring the existing Feature Requests lane.

**Architecture:** A new `bugs` table is a near-twin of `feature_requests` (migration 107), gated by the same recursion-safe `is_project_member` RLS helper. A bug carries a `severity` (the one net-new field). The lane is built from clones of the Request components (`RequestBoard`/`RequestList`/`RequestEditModal`), re-pointed at `bugs`. "Promote" reuses the existing `assignTask` flow, mapping severity → task `urgency` and stamping a 🐛 icon — no new `tasks` column, no promote RPC.

**Tech Stack:** React 18 + Vite, Supabase (Postgres + RLS), `@dnd-kit`, Vitest. Path alias `@` → `/src`.

**Reference design:** `docs/plans/2026-06-25-project-bug-lane-design.md`. Builds on the Dev Board (`docs/plans/2026-06-25-project-dev-board-design.md`, migrations 106–108).

**Working dir:** the `feat/project-bug-lane` worktree. Tests baseline: 621 passing.

---

## Task 1: Migration 109 — `bugs` table, RLS, integrity guard

**Files:**
- Create: `supabase/migrations/109_bugs.sql`

This mirrors the `feature_requests` block of `107_project_columns_and_features.sql` exactly, with `reporter_id` (not `requester_id`), a `severity` column, the bug status set, and a bug-named guard trigger. Idempotent (drop-if-exists guards) so it's safe to re-run / paste manually.

**Step 1: Write the migration**

```sql
-- ─────────────────────────────────────────────
-- 109 · Bug lane (Dev Board, part 4)
--
-- bugs = a lightweight, promotable bug report per project, mirroring
-- feature_requests (107). A bug is NOT a task — it lives on the Bugs lane
-- until Promoted, at which point the frontend's assignTask flow creates a
-- normal project-tagged fix task (urgency from severity, icon 🐛) and links
-- it via promoted_task_id.
--
-- Statuses: Reported · Confirmed · Won't Fix · Promoted (terminal = last two).
-- Any project member files AND triages (same as feature_requests).
-- Recursion-safe: gated by is_project_member() SECURITY DEFINER helper (106),
-- so no policy on `bugs` ever sub-selects project_members.
-- ─────────────────────────────────────────────

create table if not exists public.bugs (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  title            text not null,
  description      text,
  reporter_id      uuid references public.profiles(id) on delete set null,
  severity         text not null default 'Medium'
                   check (severity in ('Critical', 'High', 'Medium', 'Low')),
  status           text not null default 'Reported'
                   check (status in ('Reported', 'Confirmed', 'Won''t Fix', 'Promoted')),
  promoted_task_id uuid references public.tasks(id) on delete set null,
  pos              double precision not null default 1000,
  created_at       timestamptz not null default now()
);

create index if not exists bugs_project_idx on public.bugs(project_id);

-- ── RLS: any member files + triages (mirrors feature_requests) ──
alter table public.bugs enable row level security;

drop policy if exists "bugs_select" on public.bugs;
create policy "bugs_select" on public.bugs
  for select using (public.is_project_member(project_id));

drop policy if exists "bugs_insert" on public.bugs;
create policy "bugs_insert" on public.bugs
  for insert with check (
    public.is_project_member(project_id)
    and reporter_id = auth.uid()
  );

drop policy if exists "bugs_update" on public.bugs;
create policy "bugs_update" on public.bugs
  for update using (public.is_project_member(project_id)) with check (public.is_project_member(project_id));

drop policy if exists "bugs_delete" on public.bugs;
create policy "bugs_delete" on public.bugs
  for delete using (public.is_project_member(project_id));

-- Integrity guard: bugs_update lets any member edit the row, so require that a
-- promoted_task_id references a task in THIS project (the promote flow always
-- sets it to the freshly-created fix task, so this is transparent for the happy
-- path and only blocks spoofed/foreign links). Mirrors 107's request guard.
create or replace function public.guard_bug_promotion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.promoted_task_id is not null then
    if not exists (
      select 1 from public.tasks
       where id = new.promoted_task_id and project_id = new.project_id
    ) then
      raise exception 'bugs: promoted_task_id must reference a task in this project'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_bug_promotion_trg on public.bugs;
create trigger guard_bug_promotion_trg
  before insert or update on public.bugs
  for each row execute function public.guard_bug_promotion();
```

**Step 2: Verify it reads cleanly**

Run: `grep -c "create policy" supabase/migrations/109_bugs.sql`
Expected: `4`

(The migration is applied to Supabase manually later — see Task 8. No local DB here.)

**Step 3: Commit**

```bash
git add supabase/migrations/109_bugs.sql
git commit -m "feat(projects): bugs table + RLS + promotion guard (migration 109)"
```

---

## Task 2: Pure helpers + tests (`projectBoard.js`)

**Files:**
- Modify: `src/lib/projectBoard.js`
- Test: `src/lib/__tests__/projectBoard.test.js`

**Step 1: Write the failing tests** (append to `src/lib/__tests__/projectBoard.test.js`)

First add the new symbols to the existing top `import { ... } from '../projectBoard'` block:
`BUG_STATUSES`, `BUG_SEVERITIES`, `severityToUrgency`, `groupBugsByStatus`.

Then append:

```javascript
describe('severityToUrgency', () => {
  it('maps each severity to a task urgency', () => {
    expect(severityToUrgency('Critical')).toBe('Urgent')
    expect(severityToUrgency('High')).toBe('High')
    expect(severityToUrgency('Medium')).toBe('Med')
    expect(severityToUrgency('Low')).toBe('Low')
  })
  it('falls back to Med for unknown/empty severity', () => {
    expect(severityToUrgency(undefined)).toBe('Med')
    expect(severityToUrgency('Nonsense')).toBe('Med')
  })
})

describe('groupBugsByStatus', () => {
  it('returns all 4 statuses in board order, each sorted by pos', () => {
    const bugs = [
      { id: 'a', status: 'Reported', pos: 2000 },
      { id: 'b', status: 'Reported', pos: 1000 },
      { id: 'c', status: 'Confirmed', pos: 1000 },
      { id: 'd', status: 'Promoted', pos: 1000 },
    ]
    const groups = groupBugsByStatus(bugs)
    expect(groups.map(g => g.status)).toEqual(BUG_STATUSES)
    expect(groups[0].bugs.map(b => b.id)).toEqual(['b', 'a']) // Reported, sorted by pos
    expect(groups[1].bugs.map(b => b.id)).toEqual(['c'])      // Confirmed
    expect(groups.find(g => g.status === "Won't Fix").bugs).toEqual([]) // empty kept
  })
  it('handles null/empty input', () => {
    expect(groupBugsByStatus(null).every(g => g.bugs.length === 0)).toBe(true)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/__tests__/projectBoard.test.js`
Expected: FAIL — `severityToUrgency is not a function` / `BUG_STATUSES is not defined`.

**Step 3: Implement** (append to `src/lib/projectBoard.js`)

```javascript
// Canonical bug statuses, in board (left→right) order. Terminal: Won't Fix /
// Promoted (the fixing lifecycle lives on the promoted task, not the bug).
export const BUG_STATUSES = ['Reported', 'Confirmed', "Won't Fix", 'Promoted']

// Severity levels, highest→lowest.
export const BUG_SEVERITIES = ['Critical', 'High', 'Medium', 'Low']

// Map a bug severity to the urgency of the task it promotes into. tasks.urgency
// allows 'Urgent' since migration 087.
const SEV_TO_URGENCY = { Critical: 'Urgent', High: 'High', Medium: 'Med', Low: 'Low' }
export function severityToUrgency(sev) {
  return SEV_TO_URGENCY[sev] || 'Med'
}

// Bucket bugs into the 4 canonical statuses (always all 4, in order), each
// sorted by `pos`. Mirrors groupRequestsByStatus.
export function groupBugsByStatus(bugs) {
  const list = bugs || []
  return BUG_STATUSES.map(status => ({
    status,
    bugs: list
      .filter(b => b?.status === status)
      .sort((a, b) => (a?.pos ?? 0) - (b?.pos ?? 0)),
  }))
}
```

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/__tests__/projectBoard.test.js`
Expected: PASS (all existing + new).

**Step 5: Commit**

```bash
git add src/lib/projectBoard.js src/lib/__tests__/projectBoard.test.js
git commit -m "feat(projects): bug board pure helpers + tests (severityToUrgency, groupBugsByStatus)"
```

---

## Task 3: `useBugs` hook

**Files:**
- Create: `src/hooks/useBugs.js`

A near-clone of `src/hooks/useFeatureRequests.js`. Differences: table `bugs`, `reporter_id`/`reporter:` join, `addBug` takes `severity`, and `promote` maps severity → urgency + stamps `icon: '🐛'`.

**Step 1: Write the hook**

```javascript
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useTasks, useTaskActions, useProfiles } from './useTasks'
import { severityToUrgency } from '../lib/projectBoard'
import { showToast } from '../components/ui/index'

const POS_STEP = 1000

// Bug lane for a project. Members report + triage; promote turns a bug into a
// real fix task (urgency from severity, 🐛 icon) and marks the bug Promoted.
// Mirrors useFeatureRequests.
export function useBugs(projectId) {
  const { profile } = useAuth()
  const { refetch: refetchTasks } = useTasks()
  const { assignTask } = useTaskActions()
  const { profiles } = useProfiles()
  const [bugs, setBugs] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchBugs = useCallback(async () => {
    if (!projectId) { setBugs([]); setLoading(false); return }
    const { data, error } = await supabase
      .from('bugs')
      .select('*, reporter:profiles(id, full_name, avatar_url)')
      .eq('project_id', projectId)
      .order('pos', { ascending: true })
    if (error) { console.warn('bugs fetch failed:', error.message); setLoading(false); return }
    setBugs(data || [])
    setLoading(false)
  }, [projectId])

  useEffect(() => { fetchBugs() }, [fetchBugs])

  const addBug = useCallback(async ({ title, description = null, severity = 'Medium' }) => {
    if (!projectId || !profile?.id || !title?.trim()) return null
    const pos = bugs.length ? Math.max(...bugs.map(b => b.pos ?? 0)) + POS_STEP : POS_STEP
    const { data, error } = await supabase.from('bugs')
      .insert({ project_id: projectId, title: title.trim(), description: description?.trim() || null, severity, reporter_id: profile.id, pos })
      .select().single()
    if (error) { showToast(error.message || 'Failed to report bug', 'error'); return null }
    await fetchBugs()
    return data
  }, [projectId, profile?.id, bugs, fetchBugs])

  const setStatus = useCallback(async (id, status) => {
    const { error } = await supabase.from('bugs').update({ status }).eq('id', id)
    if (error) { showToast(error.message || 'Failed to update bug', 'error'); return false }
    await fetchBugs()
    return true
  }, [fetchBugs])

  const updateBug = useCallback(async (id, patch) => {
    const { error } = await supabase.from('bugs').update(patch).eq('id', id)
    if (error) { showToast(error.message || 'Failed to update bug', 'error'); return false }
    await fetchBugs()
    return true
  }, [fetchBugs])

  const deleteBug = useCallback(async (id) => {
    const { error } = await supabase.from('bugs').delete().eq('id', id)
    if (error) { showToast(error.message || 'Failed to delete bug', 'error'); return false }
    await fetchBugs()
    return true
  }, [fetchBugs])

  // Promote: create a fix task from the bug, assigned to the promoter, into the
  // given column; urgency from severity + 🐛 icon. Then mark Promoted + link.
  const promote = useCallback(async (bug, { columnId = null } = {}) => {
    if (!bug || !profile?.id) return null
    const res = await assignTask({
      assigneeIds: [profile.id],
      title: bug.title,
      notes: bug.description || null,
      urgency: severityToUrgency(bug.severity),
      icon: '🐛',
      allProfiles: profiles,
      projectId: bug.project_id,
      projectColumnId: columnId,
      projectPos: POS_STEP,
    })
    if (!res?.ok) { showToast(res?.msg || 'Failed to promote bug', 'error'); return null }
    const { error } = await supabase.from('bugs')
      .update({ status: 'Promoted', promoted_task_id: res.task.id })
      .eq('id', bug.id)
    if (error) showToast(error.message || 'Promoted, but failed to link bug', 'error')
    await fetchBugs()
    await refetchTasks(true)
    showToast('Promoted to a fix task')
    return res.task
  }, [profile?.id, profiles, assignTask, fetchBugs, refetchTasks])

  return { bugs, loading, addBug, setStatus, updateBug, deleteBug, promote, refetch: fetchBugs }
}
```

**Step 2: Verify it parses (build the module graph)**

Run: `npx vite build --mode development 2>&1 | tail -5` *(or defer to Task 8's full build)*
Expected: no import/syntax error referencing `useBugs.js`.

**Step 3: Commit**

```bash
git add src/hooks/useBugs.js
git commit -m "feat(projects): useBugs hook (report/triage/promote, severity→urgency)"
```

---

## Task 4: `BugEditModal` component

**Files:**
- Create: `src/components/projects/BugEditModal.jsx`

Clone of `RequestEditModal.jsx`. Adds a **Severity** selector; uses `BUG_STATUSES`; bug-flavored labels + placeholder; "Promote to Fix Task".

**Step 1: Write the component**

```jsx
import { useState } from 'react'
import { ArrowUpRight, Trash2 } from 'lucide-react'
import { ModalWrapper } from '../ui/animations'
import { BUG_STATUSES, BUG_SEVERITIES } from '../../lib/projectBoard'

// Edit a bug: title, description, severity, status. "Promote to Fix Task"
// persists edits, then hands the merged bug up so the parent creates the task
// and opens its setup panel.
export default function BugEditModal({ bug, bugs, onClose, onPromote }) {
  const { updateBug, setStatus, deleteBug } = bugs
  const [title, setTitle] = useState(bug.title || '')
  const [notes, setNotes] = useState(bug.description || '')
  const [severity, setSeverity] = useState(bug.severity || 'Medium')
  const [status, setLocalStatus] = useState(bug.status || 'Reported')
  const [busy, setBusy] = useState(false)

  const persist = async () => {
    await updateBug(bug.id, {
      title: title.trim() || bug.title,
      description: notes.trim() || null,
      severity,
    })
    if (status !== bug.status) await setStatus(bug.id, status)
  }

  const save = async () => { setBusy(true); await persist(); setBusy(false); onClose() }

  const promote = async () => {
    setBusy(true)
    await persist()
    onPromote({ ...bug, title: title.trim() || bug.title, description: notes.trim() || null, severity, status: 'Promoted' })
  }

  const remove = async () => {
    if (!confirm('Delete this bug?')) return
    setBusy(true); await deleteBug(bug.id); onClose()
  }

  const canPromote = bug.status !== 'Promoted'

  return (
    <ModalWrapper isOpen onClose={onClose}>
      <div className="bg-white dark:bg-dark-card rounded-2xl w-full max-w-md p-5 shadow-elevated">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Bug</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Title</label>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} className="form-input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Description</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} rows={4}
              placeholder="Steps to reproduce / Expected / Actual… (carried over to the fix task when promoted)"
              className="form-input w-full resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Severity</label>
              <select value={severity} onChange={e => setSeverity(e.target.value)} className="form-input w-full">
                {BUG_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Status</label>
              <select value={status} onChange={e => setLocalStatus(e.target.value)} className="form-input w-full" disabled={bug.status === 'Promoted'}>
                {BUG_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mt-5">
          <button onClick={remove} disabled={busy} className="text-red-500 hover:text-red-600 inline-flex items-center gap-1.5 text-sm px-2 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10">
            <Trash2 size={14} /> Delete
          </button>
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy} className="btn-ghost">Save</button>
            {canPromote && (
              <button onClick={promote} disabled={busy} className="btn-primary inline-flex items-center gap-1.5">
                <ArrowUpRight size={15} /> Promote to Fix Task
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalWrapper>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/projects/BugEditModal.jsx
git commit -m "feat(projects): BugEditModal (severity + status + promote)"
```

---

## Task 5: `BugList` component

**Files:**
- Create: `src/components/projects/BugList.jsx`

Clone of `RequestList.jsx`. Adds a **severity chip** per row; severity `<select>` in the add row; uses `groupBugsByStatus`/`BUG_STATUSES`; "Report a bug…".

**Step 1: Write the component**

```jsx
import { useState } from 'react'
import { Plus, ArrowUpRight, AlignLeft } from 'lucide-react'
import { groupBugsByStatus, BUG_STATUSES, BUG_SEVERITIES } from '../../lib/projectBoard'

const STATUS_STYLES = {
  'Reported':   'text-slate-500',
  'Confirmed':  'text-amber-600 dark:text-amber-300',
  "Won't Fix":  'text-red-500',
  'Promoted':   'text-emerald-600 dark:text-emerald-300',
}

// Severity chip colors. Shared by BugList + BugBoard (keep in sync).
export const SEVERITY_STYLES = {
  'Critical': 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  'High':     'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  'Medium':   'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'Low':      'bg-slate-100 text-slate-600 dark:bg-dark-border dark:text-slate-400',
}

export function SeverityChip({ severity }) {
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${SEVERITY_STYLES[severity] || SEVERITY_STYLES.Medium}`}>
      {severity}
    </span>
  )
}

export default function BugList({ bugs, onPromote, onOpenBug }) {
  const { bugs: list, addBug, setStatus } = bugs
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState('Medium')
  const groups = groupBugsByStatus(list)

  const add = async () => {
    if (!title.trim()) return
    await addBug({ title: title.trim(), severity })
    setTitle(''); setSeverity('Medium')
  }

  return (
    <div className="card">
      {list.length === 0 && (
        <p className="px-4 py-6 text-sm text-slate-400 text-center">No bugs reported. File one below.</p>
      )}
      {groups.filter(g => g.bugs.length > 0).map(group => (
        <div key={group.status} className="border-b border-slate-100 dark:border-dark-border last:border-0">
          <p className={`px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLES[group.status]}`}>
            {group.status} <span className="text-slate-300 dark:text-slate-600">({group.bugs.length})</span>
          </p>
          {group.bugs.map(b => (
            <div key={b.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-dark-hover cursor-pointer" onClick={() => onOpenBug(b)}>
              <SeverityChip severity={b.severity} />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm text-slate-800 dark:text-slate-100 truncate">{b.title}</span>
                  {b.description && <AlignLeft size={12} className="text-slate-400 shrink-0" title="Has details" />}
                </span>
                {b.reporter?.full_name && <span className="block text-[11px] text-slate-400">by {b.reporter.full_name}</span>}
              </span>
              <select
                value={b.status}
                onClick={e => e.stopPropagation()}
                onChange={e => setStatus(b.id, e.target.value)}
                disabled={b.status === 'Promoted'}
                className="form-input text-[11px] py-1 px-1.5 w-auto shrink-0"
              >
                {BUG_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {b.status !== 'Promoted' && b.status !== "Won't Fix" && (
                <button
                  onClick={(e) => { e.stopPropagation(); onPromote(b) }}
                  className="btn-ghost text-[11px] px-2 py-1 flex items-center gap-1 shrink-0"
                  title="Promote to a fix task"
                >
                  <ArrowUpRight size={12} /> Promote
                </button>
              )}
            </div>
          ))}
        </div>
      ))}

      <div className="px-4 py-2.5 flex items-center gap-2 border-t border-slate-100 dark:border-dark-border">
        <Plus size={14} className="text-slate-400" />
        <select value={severity} onChange={e => setSeverity(e.target.value)} className="form-input text-[11px] py-1 px-1.5 w-auto shrink-0">
          {BUG_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="Report a bug…"
          className="form-input text-sm flex-1 border-0 bg-transparent focus:ring-0 px-0"
        />
        {title.trim() && <button onClick={add} className="btn-primary text-xs px-3 py-1">Add</button>}
      </div>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/projects/BugList.jsx
git commit -m "feat(projects): BugList (severity chip + report row)"
```

---

## Task 6: `BugBoard` component

**Files:**
- Create: `src/components/projects/BugBoard.jsx`

Clone of `RequestBoard.jsx`. Cards show the **severity chip**; columns = `BUG_STATUSES`; promote-guard excludes `Promoted`/`Won't Fix`; quick-add "Report a bug…" (default Medium severity). Reuses `SeverityChip` from `BugList`.

**Step 1: Write the component**

```jsx
import { useState } from 'react'
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, TouchSensor, useSensor, useSensors, pointerWithin,
} from '@dnd-kit/core'
import { Plus, ArrowUpRight, AlignLeft } from 'lucide-react'
import { groupBugsByStatus } from '../../lib/projectBoard'
import { SeverityChip } from './BugList'

const CANVAS = 'rounded-xl bg-gradient-to-br from-slate-500/10 to-slate-600/10 dark:from-white/[0.04] dark:to-white/[0.02] p-3'

function BugBody({ bug, onPromote, grabbing }) {
  const canPromote = bug.status !== 'Promoted' && bug.status !== "Won't Fix"
  return (
    <div className={`bg-white dark:bg-[#22272b] rounded-lg border border-slate-200/80 dark:border-white/5 shadow-[0_1px_1px_rgba(9,30,66,0.13)] p-2.5 ${grabbing ? 'cursor-grabbing rotate-2 ring-2 ring-brand-400/70 shadow-elevated' : 'cursor-grab hover:border-brand-400 dark:hover:border-brand-500/60'} transition-colors`}>
      <div className="flex items-start gap-1.5">
        <SeverityChip severity={bug.severity} />
        <p className="text-[13px] leading-snug text-slate-800 dark:text-slate-100 flex-1 min-w-0">{bug.title}</p>
      </div>
      <div className="flex items-center gap-2 mt-1">
        {bug.reporter?.full_name && <p className="text-[11px] text-slate-400">by {bug.reporter.full_name}</p>}
        {bug.description && <AlignLeft size={12} className="text-slate-400" title="Has details" />}
      </div>
      {canPromote && onPromote && (
        <button
          onClick={(e) => { e.stopPropagation(); onPromote(bug) }}
          onPointerDown={(e) => e.stopPropagation()}
          className="mt-2 text-[11px] text-brand-600 dark:text-brand-300 hover:underline inline-flex items-center gap-1"
        >
          <ArrowUpRight size={11} /> Promote
        </button>
      )}
    </div>
  )
}

function BugCard({ bug, onPromote, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: bug.id })
  return (
    <div ref={setNodeRef} style={{ opacity: isDragging ? 0.4 : 1 }} {...attributes} {...listeners}
      onClick={() => onOpen(bug)}>
      <BugBody bug={bug} onPromote={onPromote} />
    </div>
  )
}

function StatusColumn({ status, count, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `status:${status}` })
  return (
    <div ref={setNodeRef}
      className={`flex flex-col w-[240px] shrink-0 rounded-xl bg-slate-100 dark:bg-[#1d2127] shadow-sm transition-shadow ${isOver ? 'ring-2 ring-brand-400/70' : ''}`}>
      <div className="px-3 pt-2.5 pb-1.5 flex items-center gap-1.5">
        <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">{status}</span>
        <span className="text-xs text-slate-400 bg-black/[0.04] dark:bg-white/[0.06] rounded-full px-1.5 leading-5">{count}</span>
      </div>
      <div className="space-y-2 px-2 pb-2 min-h-[8px]">{children}</div>
    </div>
  )
}

export default function BugBoard({ bugs, onPromote, onOpenBug }) {
  const { bugs: list, addBug, setStatus } = bugs
  const groups = groupBugsByStatus(list)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [activeId, setActiveId] = useState(null)
  const activeBug = activeId ? list.find(b => b.id === activeId) : null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  async function handleDragEnd(event) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const overId = String(over.id)
    if (!overId.startsWith('status:')) return
    const newStatus = overId.slice('status:'.length)
    const bug = list.find(b => b.id === active.id)
    if (bug && bug.status !== newStatus) await setStatus(active.id, newStatus)
  }

  const add = async () => { if (title.trim()) await addBug({ title: title.trim(), severity: 'Medium' }); setTitle(''); setAdding(false) }

  return (
    <div>
      <div className="mb-2">
        {adding ? (
          <input
            autoFocus value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setTitle(''); setAdding(false) } }}
            onBlur={add}
            placeholder="Report a bug…"
            className="form-input text-sm w-full max-w-sm"
          />
        ) : (
          <button onClick={() => setAdding(true)} className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5">
            <Plus size={13} /> Report a bug
          </button>
        )}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={e => setActiveId(e.active.id)}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <div className={`${CANVAS} overflow-x-auto`}>
          <div className="flex gap-3 items-start min-h-[100px]">
            {groups.map(group => (
              <StatusColumn key={group.status} status={group.status} count={group.bugs.length}>
                {group.bugs.map(b => (
                  <BugCard key={b.id} bug={b} onPromote={onPromote} onOpen={onOpenBug} />
                ))}
              </StatusColumn>
            ))}
          </div>
        </div>

        <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
          {activeBug ? <div style={{ width: 224 }}><BugBody bug={activeBug} grabbing /></div> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add src/components/projects/BugBoard.jsx
git commit -m "feat(projects): BugBoard (dnd kanban, severity chips)"
```

---

## Task 7: Wire the Bugs lane into `ProjectDetailPage`

**Files:**
- Modify: `src/pages/ProjectDetailPage.jsx`

**Step 1: Add imports** (after the existing project imports near the top)

```jsx
import { useBugs } from '../hooks/useBugs'
import BugList from '../components/projects/BugList'
import BugBoard from '../components/projects/BugBoard'
import BugEditModal from '../components/projects/BugEditModal'
```

**Step 2: Add the hook + state** (next to `const requests = useFeatureRequests(projectId)`)

```jsx
  const bugs = useBugs(projectId)
```

And next to the `editingRequest` state:

```jsx
  const [editingBug, setEditingBug] = useState(null)
  async function handlePromoteBug(bug) {
    const task = await bugs.promote(bug, { columnId: columns[0]?.id || null })
    if (task) { setEditingBug(null); setActiveTaskId(task.id) }
  }
```

**Step 3: Add the Bugs `<section>`** — immediately after the closing `</section>` of the Feature Requests block (before the closing `</div>` of `p-4 sm:p-6 space-y-8`):

```jsx
          {/* Bugs */}
          <section>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-3">Bugs</h2>
            {view === 'board' ? (
              <BugBoard bugs={bugs} onPromote={handlePromoteBug} onOpenBug={setEditingBug} />
            ) : (
              <BugList bugs={bugs} onPromote={handlePromoteBug} onOpenBug={setEditingBug} />
            )}
          </section>
```

**Step 4: Add the modal** — next to the `{editingRequest && (...)}` block:

```jsx
        {editingBug && (
          <BugEditModal
            bug={editingBug}
            bugs={bugs}
            onClose={() => setEditingBug(null)}
            onPromote={handlePromoteBug}
          />
        )}
```

**Step 5: Verify the dev server compiles**

Run: `npm run build`
Expected: build succeeds, no unresolved imports.

**Step 6: Commit**

```bash
git add src/pages/ProjectDetailPage.jsx
git commit -m "feat(projects): mount Bugs lane on the project detail page"
```

---

## Task 8: Verification + combined migration SQL

**Files:**
- Create: `docs/plans/2026-06-25-project-bug-lane-migration.sql` (copy of 109, ASCII-clean, re-run-safe, for manual paste into Supabase — matches the dev board's combined-SQL convention)

**Step 1: Full test + build gate**

Run: `npm run test:run`
Expected: PASS — 621 prior + 4 new bug-helper assertions, 0 failures.

Run: `npm run build`
Expected: build succeeds.

**Step 2: Create the manual-apply SQL**

Copy `supabase/migrations/109_bugs.sql` verbatim into `docs/plans/2026-06-25-project-bug-lane-migration.sql`. Confirm it's ASCII-clean (no smart quotes) so it pastes safely:

Run: `LC_ALL=C grep -n '[^ -~]' docs/plans/2026-06-25-project-bug-lane-migration.sql`
Expected: no output (pure ASCII). Note: the SQL string literals `'Won''t Fix'` use a plain apostrophe — keep it that way.

**Step 3: Commit**

```bash
git add docs/plans/2026-06-25-project-bug-lane-migration.sql
git commit -m "docs(projects): re-run-safe migration SQL (109) for manual apply"
```

**Step 4: Report for review.** Surface to the human:
- Migration 109 must be applied to Supabase (David) before the lane works in prod.
- Manual UI smoke checklist:
  1. Open a project → see a third **Bugs** section under Feature Requests.
  2. Report a bug (List add row, with a severity) → appears in the Reported column with a severity chip.
  3. Drag it Reported → Confirmed (Board view) → status persists on refresh.
  4. Open the card → change severity/status → Save.
  5. **Promote** (Critical) → a fix task is created, opens in `TaskDetailPanel` on the right, with urgency **Urgent** and a 🐛 icon; the bug moves to **Promoted** with a link to the task; the task also shows in the Features lane and in My Tasks.
  6. Verify a non-member cannot see the project's bugs (RLS).

---

## Notes for the executor

- **DRY:** `SeverityChip` + `SEVERITY_STYLES` are defined once in `BugList.jsx` and imported by `BugBoard.jsx`. Don't duplicate.
- **No new `tasks` column, no promote RPC** — promote reuses `assignTask` (already accepts `urgency` + `icon`).
- **Cards are not bugs and bugs are not cards** — this lane is entirely separate from the Hub Card Table.
- **Migration pitfalls** (`[[migration_pitfalls]]`): the `bugs` policies only ever call the `is_project_member` SECURITY DEFINER helper — never sub-select `project_members` — to stay clear of the hub_members recursion class. The guard trigger's `raise exception` uses no `%` placeholder, so no missing-arg `42601` (the move_feature lesson).
- After all tasks pass + build is clean: use **superpowers:finishing-a-development-branch** to decide merge/PR.
