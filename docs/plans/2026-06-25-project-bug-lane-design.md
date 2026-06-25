# Project Bug Lane — Design

**Date:** 2026-06-25
**Status:** Designed (brainstorming complete). Branch `feat/project-bug-lane`. Builds on the Dev Projects board (migrations 106–108, see `2026-06-25-project-dev-board-design.md`).

## Goal

A **third lane** on the project detail page (`/projects/:id`) — alongside **Features** and **Feature Requests** — for **reporting and triaging bugs**. A bug is an intake/triage record that members file, move through a short status lifecycle, and **Promote** into a real fix task when a dev picks it up. The lane is a near-twin of the existing Feature Requests lane, so it reuses that proven RLS + board + promote shape almost wholesale.

## Locked decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| What is a "bug"? | A **lightweight report** in a new `bugs` table (NOT a task) — mirrors `feature_requests`. Lives on the Bugs lane until **Promoted** into a fix task. |
| Status lifecycle (board columns) | **Reported · Confirmed · Won't Fix · Promoted**. Terminal = Won't Fix / Promoted. The *fixing* lifecycle lives on the promoted task, not the bug. |
| Severity | **Critical / High / Medium / Low** chip (default Medium). The one net-new field vs `feature_requests`. |
| Severity → promoted task | On Promote, severity maps to the fix task's `urgency`: **Critical→Urgent, High→High, Medium→Med, Low→Low**. |
| Promoted-task recognizability | Promote stamps `tasks.icon = '🐛'` so a bug-fix is visible as such in the Features lane. **No new `tasks` column.** |
| Permissions | **Any project member** reports AND triages (confirm / won't-fix / promote). Mirrors `feature_requests` RLS exactly. |
| Placement | Third stacked `<section>` "Bugs" on `ProjectDetailPage`, sharing the existing List ⇄ Board toggle. |

## Why this shape

- **Consistency + low risk.** `feature_requests` (migration 107) already solved the same problem: a per-project, member-managed, promotable backlog with recursion-safe RLS via the `is_project_member` SECURITY DEFINER helper. Bugs reuse that table shape, board engine, and promote flow — the only real divergence is the `severity` field and the severity→urgency map.
- **A bug becomes work only when someone commits to it.** Reporting is cheap; the heavy task machinery (assignee, comments, sub-tasks, notifications, audit, My Tasks) is created lazily, on Promote, via the existing `assignTask` flow.
- **No schema change to `tasks`.** Promote passes `urgency` + `icon` to `assignTask`; the bug-fix lands in the project's first column as an ordinary project-tagged task.

## Data model (migration 109 — `109_bugs.sql`)

```
bugs
  id               uuid pk default gen_random_uuid()
  project_id       uuid not null references projects(id) on delete cascade
  title            text not null
  description      text null              -- freeform; report form placeholder:
                                          -- "Steps to reproduce / Expected / Actual"
  reporter_id      uuid references profiles(id)
  severity         text not null default 'Medium'
                     check (severity in ('Critical','High','Medium','Low'))
  status           text not null default 'Reported'
                     check (status in ('Reported','Confirmed','Won''t Fix','Promoted'))
  promoted_task_id uuid null references tasks(id) on delete set null
  pos              double precision        -- fractional ordering (same as requests)
  created_at       timestamptz default now()
```

Cascades: `project → bugs` = `on delete cascade`. `bugs.promoted_task_id` = `on delete set null` (deleting the fix task leaves the bug as a record in the Promoted column).

## RLS (recursion-safe by reuse)

Mirror `feature_requests` exactly — any project member does everything, gated through the existing `is_project_member(project_id)` SECURITY DEFINER STABLE helper (so **no policy on `bugs` ever sub-selects `project_members`** — the hub_members recursion scar, migrations 013/017/018/093/103):

```sql
bugs_select  using (is_project_member(project_id))
bugs_insert  with check (is_project_member(project_id) and reporter_id = auth.uid())
bugs_update  using (is_project_member(project_id)) with check (is_project_member(project_id))
bugs_delete  using (is_project_member(project_id))
```

**Integrity guard trigger** (same pattern 107 applies to `feature_requests`): a `BEFORE INSERT OR UPDATE` trigger blocks setting `status='Promoted'` / `promoted_task_id` directly — only the promote path may write those (the frontend promote sets them immediately after the task insert; the trigger allows the paired write, rejects a bare hand-set). Keeps the Promoted column honest.

## Writes — `useBugs(projectId)` hook (near-clone of `useFeatureRequests`)

- `addBug({ title, description, severity })` — insert with `reporter_id = me`, `pos = max+POS_STEP`.
- `setStatus(id, status)` — board drag + status dropdown.
- `updateBug(id, patch)` / `deleteBug(id)` — same as requests.
- `promote(bug, { columnId })` — the one meaningful divergence from `requests.promote`:
  ```js
  const SEV_TO_URGENCY = { Critical: 'Urgent', High: 'High', Medium: 'Med', Low: 'Low' }
  const res = await assignTask({
    assigneeIds: [profile.id],
    title: bug.title,
    notes: bug.description || null,
    urgency: SEV_TO_URGENCY[bug.severity] || 'Med',
    icon: '🐛',
    allProfiles: profiles,
    projectId: bug.project_id,
    projectColumnId: columnId,
    projectPos: POS_STEP,
  })
  // then: bugs.update({ status: 'Promoted', promoted_task_id: res.task.id }).eq('id', bug.id)
  // then: refetch bugs + refetchTasks(true); open the new task's TaskDetailPanel inline
  ```
  Reuses `assignTask` (which already accepts `urgency` + `icon`). **No promote RPC** — consistent with the current frontend-promote reality (the `promote_request` RPC was dropped).

Board moves are just `setStatus` (status = column). **No `move_feature`-style RPC** — bug ordering is per-status, identical to `RequestBoard`.

## UI

Third stacked `<section>` titled **Bugs** on `ProjectDetailPage`, below Feature Requests, sharing the same List ⇄ Board toggle.

- **`BugBoard.jsx`** — kanban, 4 columns = the statuses. Drag between columns → `setStatus`. `@dnd-kit`, mirrors `RequestBoard`. Promoted column cards show a link chip to the fix task.
- **`BugList.jsx`** — rows grouped by status; reporter, severity chip, status dropdown, **Promote →**. Mirrors `RequestList`.
- **`BugCard`** — title, colored **severity chip** (Critical→`.priority-red`, High→`.priority-orange`, Medium→`.priority-yellow`, Low→slate), reporter avatar.
- **`BugEditModal.jsx`** — clone of `RequestEditModal`: title, description (guided placeholder), **severity selector**, status, Promote. "Report Bug" opens it in create mode.
- **Promote UX** — on success, close modal + open the new fix-task's `TaskDetailPanel` inline (exactly what `handlePromote` does for requests).

## Pure-logic units (TDD targets)

- `severityToUrgency(sev)` → `{Critical:'Urgent', High:'High', Medium:'Med', Low:'Low'}` (fallback `'Med'`).
- `groupBugsByStatus(bugs)` → mirrors `groupRequestsByStatus`.

(Both small; live in `src/lib/projectBoard.js` or a sibling. UI is smoke-tested manually per repo convention — no component tests.)

## Out of scope (v1, YAGNI)

- Bug→feature linkage beyond `promoted_task_id`; duplicate-merging.
- Attachments/screenshots on the bug *record* (the promoted task already supports attachments).
- Severity-based auto-assignment; SLA timers.
- Externals (Agent/Client) reporting bugs.
- Reverse sync (un-promoting; reopening a bug from a closed task).

## Verification gates

- `npm run test:run` (pure-logic + full suite green), `npm run build`.
- Manual UI smoke (headless OAuth unavailable).
- Migration 109 applied to Supabase before the lane is usable.
