# Recurring Tasks — Design v2 (drawing-board reset)

**Date:** 2026-04-27
**Status:** Approved, ready for implementation
**Supersedes:** the v1 implementation in `2026-04-23-task-improvements-design.md` §5 + the Settings → Recurring Tasks card shipped earlier on 2026-04-27.
**Reason for reset:** v1 placed creation in Settings (an admin-y location for a productivity feature) and exposed sysadmin-style fields ("anchor_at", "due offset hours", "next_run_at") that confused users. v2 keeps the working schema + edge function but replaces the UX entirely.

---

## Decisions locked in (Q&A summary)

| # | Question | Answer |
|---|---|---|
| 1 | Where does the feature live? | **C — hybrid**: recurrence is a property of a task creation flow, plus a "Recurring" view on My Tasks for management. |
| 2 | Frequency picker shape? | **B** — preset dropdown (Don't repeat / Daily / Weekly / Every 2 weeks / Monthly / Yearly / Custom...) with Custom expanding inline. |
| 3 | When does the first occurrence land? | **C** — ask the user via a Start picker. Default = Today (now). Times in **Eastern Time** (DST-aware via `America/New_York`). |
| 4 | Completion behavior? | **A — schedule-based.** Cadence advances regardless of when the assignee completes. |
| 5 | Recurring management surface? | **A** — third tab on My Tasks: `Recurring (N)`. Hidden if user has 0 templates. |
| 6 | Visual cue on spawned tasks in lists? | **A** — tiny 🔁 icon next to the title chip row + bell-notification on spawn (reuses existing assignment pipeline). |
| 7 | Editing a template's effect on already-spawned open tasks? | **C** — Google Calendar-style confirm: `Future spawns only / Future + existing open / Just this one occurrence`. |

---

## UX flow (the user-visible feature)

### Creating a recurring task

David goes to **Assign a Task**. The existing form gains one new field:

```
Repeat:  [ Don't repeat ▼ ]
         Don't repeat        ← default
         Daily
         Weekly
         Every 2 weeks
         Monthly
         Yearly
         Custom…             ← reveals: Every [N] [day/week/month] inline
```

When `Repeat ≠ Don't repeat`, two extra rows appear:

```
Start:   [ Today (Apr 27, 9:00 AM ET) ▼ ]
First spawn: Today, 9:00 AM ET            ← live preview
```

When `Repeat = Don't repeat` the form behaves identically to today.

The form's existing **Due date** picker is replaced (only when Repeat ≠ "Don't repeat") with a single "Due in [N] hours after each spawn" field, default 24 hours. Avoids the v1 "due offset hours" jargon by giving it user-language framing.

Submit creates a `task_recurrences` row **and** spawns occurrence #1 immediately. So the user's experience is "I assigned a task and there it is in my list."

### Managing recurring templates

A new tab on `MyTasksPage` next to "Assigned to Me" / "Assigned by Me":

```
[ Assigned to Me (24) ] [ Assigned by Me (2) ] [ Recurring (3) ]
```

Tab is hidden when the user has zero templates.

Tab content — one row per template owned by the current user:

```
🔁  Weekly QA review                                          [⏸] [✏] [🗑]
    every week · next in 4 days · Alice Chen, Bob Reyes · Operations

🔁  Monthly client report                              [Paused] [▶] [✏] [🗑]
    every month · Alice Chen
```

Inline actions: **pause/play** toggles `is_active`. **Edit** opens the same form modal as creation, prefilled. **Delete** removes the template (cascade-deletes audit; spawned tasks stay with `recurrence_id` flipped to null via FK).

### Visual cue for spawned tasks

In the regular My Tasks / Team View list, recurring-spawned tasks get a small 🔁 icon next to the existing title chip row. No left-border accent, no row-level pill. Hover shows "Recurring · every week".

In the detail panel, the header keeps the larger purple pill: `🔁 Recurring · every week → Open template`. Click jumps to the Recurring tab with the template highlighted.

### Notification bell on spawn

A spawned task fires the same bell entry as any new task assignment (the existing `task_assignees` insert is the only signal needed). No new bell code path — verify only.

---

## Editing semantics (the Calendar-style confirm)

Click ✏ on a Recurring-tab row → opens the form modal pre-filled. On Save, a confirm dialog:

```
Apply changes to:
  ◉ Future spawns only            ← default
  ○ Future spawns + existing open tasks
  ○ Just this one occurrence       (only shown if invoked from a spawned-task panel,
                                    not from the Recurring tab)
```

Implementation:
- **Future only**: patch `task_recurrences` row only.
- **Future + existing open**: patch the template, then bulk-update the same fields on `tasks WHERE recurrence_id = ? AND status != 'Done'`.
- **Just this one occurrence**: standard per-task edit (already supported by the panel's "Edit task" pencil; this option is a hint pointing them to that flow rather than a separate code path).

Editing a single spawned task from My Tasks works exactly as today (per-task pencil). The detail panel gets one extra inline link "Edit recurring template..." for users who want to jump to the template editor.

---

## Edge cases

- **Past start date** — if user picks Start = yesterday, occurrence #1 spawns on submit and `next_run_at` is computed by the helper to the next future cadence point. No backfill.
- **All assignees invalid at spawn time** — template auto-pauses, audit row, creator email. Already implemented in `spawn-recurring-tasks` edge function.
- **Pause/resume** — `is_active=false` freezes spawning. On resume, the spawn function recomputes `next_run_at` to the next future occurrence (no backfill).
- **Template delete with open spawned tasks** — spawned tasks stay; their `recurrence_id` becomes null via FK `on delete set null`. Their detail-panel pill disappears.
- **Externals (Agent/Client)** — blocked from creating templates by both UI (Repeat field hidden on Assign a Task) and RLS WITH CHECK. Already enforced.
- **DST transitions** — using `America/New_York` (DST-aware) everywhere, both in display and in the helper functions. JS `Date` handles this natively when we don't manually pin to UTC offsets.

---

## What we keep from v1

- **Migration 058** (`task_recurrences`, `task_recurrence_assignees`, `task_recurrence_audit`, `tasks.recurrence_id`, RLS, audit trigger).
- **Migration 059** (pg_cron `spawn-recurring-tasks-hourly` schedule).
- **Migration 060** (audit-trigger fix for DELETE).
- **Edge function** `spawn-recurring-tasks` — already idempotent and verified live.
- **Edge function** `notify` extension for `recurring_spawn_failed`.
- **`compute_next_recurrence_run`** SQL helper + JS mirror in `src/lib/recurrence.js`.
- **`useRecurrences`** hook (CRUD).
- **TaskTable** 🔁 icon on spawned-task rows.
- **TaskDetailPanel** 🔁 Recurring pill in header.
- All 21 tests in `recurrence.test.js`.

## What we remove

- `src/components/settings/RecurringTasksCard.jsx` — file deleted.
- Settings page card import + render of `RecurringTasksCard`.

## What we add

1. **AssignTaskPage** gains a `Repeat` field + conditional `Start` picker + conditional `Custom…` interval triplet. Submit branches: if repeat ≠ "Don't repeat", call `useRecurrences.createTemplate()` (which spawns occurrence #1 internally); otherwise call existing `assignTask`.
2. **MyTasksPage** gains a third tab `Recurring`. Tab content is a new `RecurringList` component that reuses the row layout from the deleted `RecurringTasksCard` minus the "create" entry point.
3. **Recurring template editor modal** — moved out of the deleted Settings card into a shared `RecurrenceEditorModal` component, opened from (a) the Recurring tab's edit button and (b) the "Edit recurring template..." link on a spawned task's detail panel.
4. **Calendar-style confirm dialog** on edit Save — three radio options, default "Future only". Bulk-update path for "Future + existing open".
5. **`updateTemplateAndSpawnedTasks(id, patch)`** addition to `useRecurrences` — wraps the template UPDATE + a conditional `tasks WHERE recurrence_id=? AND status<>'Done'` UPDATE in sequence.

---

## Tests

Existing 21 tests in `recurrence.test.js` stay. Add 3:
- "Past start date returns now-or-future" — covers the yesterday-or-earlier Start picker path.
- "Custom interval N=10 weeks computes correctly" — covers the Custom expansion.
- "ET timezone math handles DST spring-forward and fall-back" — covers the most realistic user-visible failure surface.

Manual QA (dev only):

1. Assign a Task → leave Repeat as "Don't repeat" → submit. Confirm form behavior identical to today.
2. Same form, set Repeat=Weekly → confirm Start picker + "First spawn" preview appear. Submit → task lands in My Tasks AND template lands in Recurring tab.
3. Recurring tab → pause one template → confirm "Paused" badge + countdown disappears.
4. Edit template → change urgency → on Save, get confirm dialog → pick "Future only" → confirm existing open spawned tasks unchanged.
5. Edit again → pick "Future + existing open" → confirm one open spawned task's urgency updated.
6. Manually trigger spawn (curl) → confirm assignee's bell pings.
7. Login as Agent/Client → confirm Repeat field absent on Assign a Task and Recurring tab not shown.

---

## Rollout

1. Write design doc + commit (this file).
2. Delete `RecurringTasksCard` + its Settings wiring.
3. Add `Repeat` + `Start` to `AssignTaskPage` + frontend wiring.
4. Add `Recurring` tab on `MyTasksPage` + the `RecurrenceEditorModal`.
5. Add `updateTemplateAndSpawnedTasks` helper + the Calendar-style confirm.
6. Add 3 new tests.
7. Run full test suite + the 7 manual QA steps.
8. Commit + merge to `main`.
9. Update `2026-04-27.md` daily note.

No new migrations needed — schema already supports everything.

---

## Follow-ups (out of scope for this redesign)

- Webhook-secret enforcement on cron-driven edge functions (`spawn-recurring-tasks`, `dm-offline-notify`, `send-alerts`) — track separately; same fix sweep for all of them.
- Sub-hour cadences (e.g. "every 30 minutes") — would need a more frequent cron schedule. Not on v2 scope.
- Per-assignee staggered spawns ("rotate weekly Standup duty between Alice and Bob") — request hasn't surfaced; defer.
