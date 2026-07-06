# Calendar View — Notion-style month calendar for Tasks + Dev Project Features

**Date:** 2026-07-05 · **Status:** approved scope, ready to implement
**Scope decision (Ian):** v1 = month grid + priority-colored pills + click-to-open
panel + "No due date" tray + drag-to-reschedule. Week view, day-cell
quick-create, and multi-day spans are explicit v2.

## What we're replicating (Notion research)

Notion's database calendar ([help/calendars](https://www.notion.com/help/calendars)):
month grid keyed on a date property, items as pills on their day,
drag-and-drop a pill to another day to change its date, `< Today >`
navigation, click a pill for a side-peek, configurable pill properties.
Parity gaps we accept in v1: multi-day spanning (needs a start date column we
don't have), week layout, in-calendar creation.

## Mapping onto Project Engine — zero DB changes

| Notion concept | Ours (already exists) |
|---|---|
| Date property | `tasks.due_date` (date-only string) |
| Drag to reschedule | `updateTask(id, {due_date})` from `useTasks` — writes `due_date_changed` audit (002), realtime refetch |
| Side peek on click | `TaskDetailPanel` (task pages) / inline panel on `ProjectDetailPage` |
| Pill color property | live priority engine → `.priority-red/orange/yellow/green` |
| View switcher | existing list/kanban toggles: `pe-task-view`, `pe-team-view-mode`, `pe-admin-view-mode`, `pe-project-view` — calendar is one more value |
| No-date items | collapsible "No due date (N)" tray; pills drag out onto days |

**Break-nothing guarantees:** no schema/RLS/trigger changes; list + kanban
code paths untouched (calendar is an additive branch in each view switch);
the ONLY write is the existing `updateTask` due-date path; a drop that RLS
rejects surfaces the existing error toast and the realtime refetch snaps the
pill back. dnd-kit is already a dependency. NO `AnimatePresence popLayout` /
`layoutId` in the grid (2026-07-05 Sentry removeChild lesson).

## Phases

### Phase 1 — pure logic + tests (TDD)
`src/lib/calendar.js`:
- `monthMatrix(year, month, {weekStartsOn: 1, now})` → weeks of 7 day cells
  `{iso, dayOfMonth, inMonth, isToday}` including prev/next-month spillover.
- `bucketTasksByDay(tasks)` → `{ byDay: Map<iso, task[]>, undated: task[] }`
  parsing `due_date` as LOCAL midnight (same UTC-midnight pitfall
  `projectBoard.parseDueLocal` solves — negative-UTC users must not see
  tasks on the wrong day).
- `addMonths(year, month, delta)`, `formatMonthTitle(year, month)`.
`src/lib/__tests__/calendar.test.js`: month boundaries, leap Feb, Monday
start, spillover cells, timezone bucketing, undated split, injectable now.

### Phase 2 — shared component
`src/components/tasks/TaskCalendar.jsx` (presentational, no data fetching):
- Props: `tasks`, `onOpenTask(task)`, `onReschedule(taskId, iso)`.
- Header: `‹ [Month Year] ›` + `Today` + `No due date (N)` tray toggle.
- 7-col grid, `.card` styling, dark-mode aware, today ring, muted
  weekends/spillover. Pills: priority dot + truncated title; day overflow
  collapses to `+N` with a popover.
- dnd-kit: pills draggable; day cells + tray droppable; `DragOverlay` for
  the lifted pill. Drop on same day = no-op.
- Month cursor is component state; starts at current month.

### Phase 3 — task pages
Add the calendar option (lucide `CalendarDays`) to the existing view
toggles in `MyTasksPage`, `TeamViewPage`, `AdminOverviewPage`; render
`<TaskCalendar tasks={<same filtered list the other views get>}
onOpenTask={existing panel opener} onReschedule={(id, d) =>
updateTask(id, {due_date: d})} />`. Filters/search apply upstream — the
calendar always shows exactly what list/kanban would.

### Phase 4 — Dev Project Features lane
`ProjectDetailPage`: Features view toggle becomes list | board | calendar
(same `pe-project-view` key). Calendar receives `visibleFeatures` (already
filter-aware), opens features via `setActiveTaskId`, reschedules via the
same `updateTask`. Requests/Bugs lanes unchanged (no due dates).

### Phase 5 — verification
- Unit suite + build green.
- Playwright sweep with the established magic-link harness (mint session
  via service role, drive localhost): correct bucketing, month navigation,
  Today, tray, drag day→day (assert `due_date` + `due_date_changed` audit
  row via service role), drag from tray, click-open, all four surfaces.
  Test task created in a QA project via service role, then purged
  (including `notification_outbox` rows — dev_api memory gotcha).

### v2 backlog (explicitly out)
Week view · hover-`+` day quick-create prefilled with the date ·
multi-day spans (needs `start_date`) · pill property configurability.

## Rollback
Frontend-only; single revert. No data to unwind.
