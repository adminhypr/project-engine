# Calendar Multi-Day Spans — Notion-style bars

**Date:** 2026-07-05 · **Status:** approved scope, ready to implement
**Scope decisions (Ian):** span strip above the pills (single-day pills
unchanged) · v1 includes bar-move AND edge-resize + a Start-date field in the
task panel.

## Model

`tasks.start_date timestamptz NULL` (migration 116). NULL = single-day task —
every existing task and write path behaves exactly as today. A task becomes a
span when `start_date` is set (panel field or a future API write).

**Deliberately NO start<=due CHECK constraint.** dev-api `PATCH /tasks/:id`,
`spawn_recurrence`, QuickAddModal, and TaskDetailPanel all write `due_date`
without knowing about `start_date`; a constraint would 23514 them (pitfall
Nr. 10 — tighter constraint on one path breaks the parallel paths). Instead
`spanForTask()` normalizes defensively: start missing/invalid/after due →
render as single-day at due_date. Unit-tested.

## Migration 116 (single file, idempotent, ASCII)

Live bodies were read from prod on 2026-07-05 before writing this plan
(102 drift lesson — never trust the migration files for CURRENT bodies):

1. `alter table public.tasks add column if not exists start_date timestamptz;`
2. `task_audit_log_event_type_check`: drop + recreate with the canonical
   list from 102 **plus `'start_date_changed'`** (21 values).
3. Recreate `audit_task_updated()` = exact live body + one block after the
   due_date block:
   `if new.start_date is distinct from old.start_date -> insert
   'start_date_changed' (old/new ::text, 'none'/'removed' style mirrors
   due_date).`
4. Recreate `guard_task_non_owner_update()` = exact live body + add
   `or new.start_date is distinct from old.start_date` to the secondary-
   assignee blocklist — otherwise a secondary assignee could move a span's
   START but not its END (found by reading the live guard; it blocklists
   due_date).
5. Apply via Management API query endpoint (NOT `db push` — remote history
   stops at 104).

No RLS changes (column rides existing tasks policies). Realtime unchanged.
Rollback: drop column + restore 20-value CHECK + previous two bodies.

## Pure logic (TDD, `src/lib/calendar.js`)

- `spanForTask(task)` → `{startIso, endIso}` | `null`. Null unless
  `start_date` valid AND local-day(start) < local-day(due). Same-day span
  degrades to a normal pill. All local-day math (timestamptz pitfall).
- `weekSpanSegments(weekCells, tasks)` → per week row:
  `[{task, startCol, endCol, continuesLeft, continuesRight, lane}]`.
  Greedy lane packing: sort by startCol then longer-first; first free lane.
- `shiftSpan(task, targetIso)` → `{start_date, due_date}` — bar-move drop:
  the GRABBED day maps to targetIso… simpler v1: bar drag anchors its START
  to the drop day and preserves duration + both LOCAL times-of-day.
- `resizeSpan(task, edge, targetIso)` → patch for one end, clamped so
  start-day <= end-day (drag past the other end = collapse to 1 day, which
  clears `start_date` when days become equal). Preserves times.
- `bucketTasksByDay` change: tasks WITH a valid span are excluded from the
  per-day pill buckets (they live in the strip); undated logic unchanged.

## UI (TaskCalendar only — no other component touched)

- Each week row becomes `relative`; a span strip renders absolutely above
  the day cells' pill area: bars = `left/width` in 1/7 units per segment,
  stacked by lane (row min-height grows by `lanes * barHeight`).
- Bar: priority dot + title (+ visibleProps badges, same PillProps), rounded
  ends; flat edge + chevron where `continuesLeft/Right`. Click → onOpenTask.
- Drag = three dnd-kit draggables per bar: body (`span-move-<id>`), left
  handle (`span-start-<id>`), right handle (`span-end-<id>`). Existing day
  cells stay the droppables. `handleDragEnd` routes by id prefix →
  `onReschedulePatch(taskId, patch)` (new generalized callback; pages call
  `updateTask(taskId, patch)` — one line changed per page).
- No-due-date tray: dropping a BAR on it clears both dates. Bars never
  appear in the tray (they have dates by definition).
- No popLayout/layoutId anywhere near the strip (removeChild crash class).

## Task panel

`TaskDetailPanel`: "Start date" date input beside Due date — sets
`start_date` via the existing update path (17:00-local default via
`dueDateForDay`), with an × to clear. This is how a task first BECOMES a
span.

## Out of scope (follow-ups)

dev-api `start_date` on PATCH/create · Assign page + QuickAdd start field ·
TaskTable/Kanban span display · recurrence templates with spans.

## Phases

1. **Migration 116** — write from the live bodies above, apply, verify
   (column exists; audit fires on start_date change; secondary-assignee
   guard blocks start_date; existing due-date-only writes still work).
2. **Span helpers + tests** — spanForTask / weekSpanSegments (lane packing,
   continues flags, month + week modes) / shiftSpan / resizeSpan /
   bucketTasksByDay exclusion. RED→GREEN.
3. **Strip rendering** — bars, lanes, continues chevrons, click-open,
   property badges; month + week modes. Playwright visual check.
4. **Gestures** — move + both resize handles + tray-clear; generalized
   onReschedulePatch threaded through the 4 pages.
5. **Panel field** — Start date set/clear in TaskDetailPanel.
6. **QA + ship** — throwaway spanned task via service role: bar renders
   across a week boundary with continues flags; move preserves duration +
   times (DB-verified); resize both edges; collapse-to-single-day clears
   start_date; audit rows for every gesture; purge (outbox included);
   deploy + chunk-verify.
