# Project Dev Board (Trello-style) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A Trello-style developer project board — Projects (explicit membership) → Features (real tasks, with % completion / status / owner / due) on freeform lists → a promotable Feature Request backlog.

**Architecture:** New `projects` / `project_members` / `project_columns` / `feature_requests` tables + three nullable `tasks.project_*` columns. Features are tasks; the board is a lens. Recursion-safe RLS via SECURITY DEFINER helpers; one inline branch on the tasks SELECT predicate grants project members feature visibility. Board moves + promote go through SECURITY DEFINER RPCs. `@dnd-kit` board with fractional `pos`.

**Tech Stack:** React 18 + Vite, Supabase (Postgres + RLS), `@dnd-kit`, Vitest, Tailwind, lucide-react, framer-motion, React Router v6.

**Design:** `docs/plans/2026-06-25-project-dev-board-design.md`.

**Deploy ordering:** migrations 106–108 must be applied to Supabase before the feature works. Frontend degrades gracefully (queries error → empty board) until then. No cron/webhook concerns.

---

## Phase 1 — Schema & RLS

### Task 1: Migration 106 — projects + members + helpers

**Files:** Create `supabase/migrations/106_projects.sql`

Contents:
- `projects` table (id, name, description, status CHECK ∈ Active/On Hold/Completed/Archived default Active, target_date date null, created_by, created_at).
- `project_members` table (project_id, profile_id, role CHECK ∈ owner/admin/member, created_at, PK (project_id, profile_id)), `on delete cascade` to projects + profiles.
- **SECURITY DEFINER STABLE helpers** (search_path locked, per migration 051 pattern):
  - `is_project_member(p_project uuid) returns boolean` → `exists(select 1 from project_members where project_id=p_project and profile_id=auth.uid())`.
  - `is_project_admin(p_project uuid) returns boolean` → same with `role in ('owner','admin')`.
- Enable RLS. Policies:
  - `projects_select` → `is_project_member(id)`.
  - `projects_insert` → `created_by = auth.uid()` AND `is_external_user()` is false (block externals).
  - `projects_update` / `projects_delete` → `is_project_admin(id)`.
  - `project_members_select` → `is_project_member(project_id)`.
  - `project_members_insert` → `is_project_admin(project_id)` OR creator-self-owner-on-empty-project path (migration 074 pattern: allow `profile_id=auth.uid() AND role='owner'` only when the project has no members yet).
  - `project_members_update/delete` → `is_project_admin(project_id)` (and never let the last owner be removed — guard trigger, mirrors migration 094).
- `create_project_with_owner(p_name, p_description)` SECURITY DEFINER RPC: inserts the project + the owner `project_members` row atomically (mirrors `create_hub_with_owner`, migration 091), returns the project id.

**Verify:** SQL reads cleanly; helper functions are SECURITY DEFINER + `set search_path`. **Commit.**

### Task 2: Migration 107 — columns, feature_requests, tasks.project_* columns

**Files:** Create `supabase/migrations/107_project_columns_and_features.sql`

- `project_columns` (id, project_id, name, color, pos double precision, maps_to_status text null CHECK ∈ the 4 statuses, created_at), `on delete cascade` to projects.
- `feature_requests` (id, project_id, title, description, requester_id, status CHECK ∈ Requested/Under Review/Planned/Rejected/Promoted default Requested, promoted_task_id uuid null references tasks on delete set null, pos double precision, created_at), `on delete cascade` to projects.
- `alter table tasks add column project_id uuid null references projects(id) on delete set null`, `project_column_id uuid null references project_columns(id) on delete set null`, `project_pos double precision null`.
- Indexes: `tasks(project_id)`, `project_columns(project_id)`, `feature_requests(project_id)`.
- RLS:
  - `project_columns` select → `is_project_member(project_id)`; insert/update/delete → `is_project_admin(project_id)`.
  - `feature_requests` select → `is_project_member(project_id)`; insert → `is_project_member` (any member can file a request, requester_id=auth.uid()); update/delete → `is_project_member` (members triage) — keep simple; tighten later if needed.

**Verify:** reads cleanly. **Commit.**

### Task 3: Migration 108 — tasks visibility branch + RPCs

**Files:** Create `supabase/migrations/108_project_task_visibility_and_rpcs.sql`

- **Extend the tasks SELECT policy** (`tasks_select` from migration 097) by adding, INLINE inside the existing predicate, `OR (project_id is not null and public.is_project_member(project_id))`. Recreate the policy with the full predicate (do NOT wrap in a STABLE function — 097 scar). Document the one-line addition in the header.
- `move_feature(p_task uuid, p_column uuid, p_pos double precision)` SECURITY DEFINER: assert `is_project_member` of the task's project; update `project_column_id`, `project_pos`; if the target column's `maps_to_status` is non-null, also set `tasks.status` (reuse the GUC/trigger path that a normal status update would hit). Return void.
- `promote_request(p_request uuid, p_assignee uuid default null, p_due date default null)` SECURITY DEFINER: assert member; insert a task (title/description from the request, project_id, into the project's lowest-`pos` column, assigned_by=auth.uid(), assignee if provided), set the request `status='Promoted'`, `promoted_task_id=<new task>`; return the new task id. (Pre-spawn validation in TS; mirrors the spawn_recurrence split.)

**Verify:** reads cleanly; confirm the tasks predicate still contains the original branches verbatim plus the new OR. **Commit.**

---

## Phase 2 — Pure logic (TDD)

### Task 4: `src/lib/projectBoard.js` helpers + tests

**Files:** Create `src/lib/projectBoard.js`, Test `src/lib/__tests__/projectBoard.test.js`

**Step 1 — write failing tests** covering:

```js
import { fractionalPos, featureProgress, projectProgress, groupFeaturesByColumn, groupRequestsByStatus } from '../projectBoard'

// fractionalPos(before, after) → midpoint; handles ends (null neighbors)
test('midpoint between two positions', () => expect(fractionalPos(1, 2)).toBe(1.5))
test('insert at start (no before)', () => expect(fractionalPos(null, 2)).toBe(1))      // before-1 convention
test('insert at end (no after)', () => expect(fractionalPos(4, null)).toBe(5))         // after+1
test('empty column', () => expect(fractionalPos(null, null)).toBe(1))

// featureProgress(task): subtasks done/total → pct; fallback to status
test('progress from subtasks', () => expect(featureProgress({ subtask_count: 4, open_subtask_count: 1 }).pct).toBe(75))
test('no subtasks, Done = 100', () => expect(featureProgress({ subtask_count: 0, status: 'Done' }).pct).toBe(100))
test('no subtasks, Not Started = 0', () => expect(featureProgress({ subtask_count: 0, status: 'Not Started' }).pct).toBe(0))
test('no subtasks, In Progress = null (show dash)', () => expect(featureProgress({ subtask_count: 0, status: 'In Progress' }).pct).toBe(null))

// projectProgress(features) → avg of pct (treating null as 0 or excluded — pick & test)
test('project progress averages feature pct', () => expect(projectProgress([{ pct: 100 }, { pct: 50 }])).toBe(75))

// grouping
test('groups features by column id, ordered by project_pos', () => { /* ... */ })
test('groups requests by status into the 5 buckets', () => { /* ... */ })
```

**Step 2** run → fail (module missing). **Step 3** implement minimal. **Step 4** run → pass. **Step 5 commit.**

(`featureProgress` mirrors the existing `subtask_count`/`open_subtask_count` enrichment in `useTasks`. Decide null-handling for In-Progress-no-subtasks and encode it in the test.)

---

## Phase 3 — Data hooks

### Task 5: `useProjects` + `useProjectMembers`
**Files:** Create `src/hooks/useProjects.js`, `src/hooks/useProjectMembers.js`
- `useProjects`: list projects (RLS-scoped), `createProject` (calls `create_project_with_owner` RPC), `updateProject`, `archiveProject`. Realtime optional (v1 can refetch).
- `useProjectMembers(projectId)`: list, add, remove, change role (admin-gated by RLS).
- **Verify:** `npm run build`. **Commit.**

### Task 6: `useProjectColumns` + `useProjectFeatures` + `useFeatureRequests`
**Files:** Create the three hooks under `src/hooks/`.
- `useProjectColumns(projectId)`: CRUD columns; reorder via fractional pos.
- `useProjectFeatures(projectId)`: fetch tasks `where project_id = projectId` (enriched like `useTasks`: priority, subtask counts → reuse the enrichment or the `useTasks` context filtered by project_id); `addFeature` (insert task with project_id + column); `moveFeature` (calls `move_feature` RPC).
- `useFeatureRequests(projectId)`: CRUD requests; `setStatus`; `promote` (calls `promote_request` RPC).
- **Verify:** `npm run build`. **Commit.**

> Reuse note: features are tasks. Prefer deriving the project's features from the existing `useTasks` context (`tasks.filter(t => t.project_id === id)`) so enrichment (% inputs, assignees, unread) comes for free, and only use a dedicated fetch if the tasks context doesn't include them (it should, given the new RLS branch).

---

## Phase 4 — Routing, nav, project list

### Task 7: Routes + nav entry
**Files:** Modify `src/App.jsx` (add `/projects` and `/projects/:projectId` routes, wrapped like other routes), `src/components/layout/Layout.jsx` (nav item "Projects", lucide `KanbanSquare` or `FolderKanban`; hidden for externals).
- **Verify:** `npm run build`. **Commit.**

### Task 8: Projects list page
**Files:** Create `src/pages/ProjectsPage.jsx`
- Uses `useProjects`. Renders project cards (name, status badge, target date, overall progress bar via `projectProgress`, member avatars, feature count). "New Project" modal → `createProject` → navigate to `/projects/:id`.
- Page shell = `PageHeader` + grid (match existing pages).
- **Verify:** `npm run build`. **Commit.**

---

## Phase 5 — Project detail + Features board

### Task 9: Project detail shell + List/Board toggle
**Files:** Create `src/pages/ProjectDetailPage.jsx`
- Header (name, status, target date, members, edit for admins). List⇄Board toggle (localStorage key `pe-project-view`, mirror MyTasksPage's `switchView`). Two sections scaffolded (Features, Requests).
- **Verify:** `npm run build`. **Commit.**

### Task 10: Features — List view
**Files:** Create `src/components/projects/FeatureList.jsx`
- Rows: title, `% bar` (new small `<ProgressBar pct=… />` in `src/components/projects/`), status badge, owner, due. Row click → open existing `TaskDetailPanel` (reuse). "Add Feature" inline (creates task w/ project_id + first column).
- **Verify:** `npm run build`. **Commit.**

### Task 11: Features — Trello board (dnd-kit)
**Files:** Create `src/components/projects/FeatureBoard.jsx`, `src/components/projects/FeatureCard.jsx`
- Columns from `useProjectColumns`; cards grouped via `groupFeaturesByColumn`. `@dnd-kit` drag within/between columns; on drop compute `fractionalPos` and call `moveFeature` (RPC) optimistically. Card shows title, % bar, owner avatar, due. Column header: name, count, add-card, (admin) rename/recolor/reorder + `maps_to_status` picker.
- Reference the existing Card Table (`src/components/hub/cards/CardTable.jsx`) for the dnd-kit board structure; re-point at tasks.
- **Verify:** `npm run build`. **Commit.**

---

## Phase 6 — Feature Requests + promote

### Task 12: Requests — list + board + promote
**Files:** Create `src/components/projects/RequestList.jsx`, `src/components/projects/RequestBoard.jsx`
- List grouped by status (`groupRequestsByStatus`) with requester + status dropdown + **Promote →**. Board = triage kanban (columns = the 5 statuses), drag → `setStatus`. Promote → `promote` (RPC) → toast + (optional) navigate to the new feature. "Add request" one-liner.
- **Verify:** `npm run build`. **Commit.**

---

## Phase 7 — Linking & polish

### Task 13: Tag existing tasks to a project
**Files:** Modify `src/components/tasks/TaskDetailPanel.jsx` (+ optionally `AssignTaskPage`)
- Add an optional **Project** picker (only projects you're a member of) on the task detail panel; setting it writes `project_id` (+ default column/pos). This lets existing tasks become Features.
- **Verify:** `npm run build`. **Commit.**

### Task 14: Final verification
- `npm run test:run` (all pass incl. `projectBoard.test.js`), `npm run build`.
- Update design doc status → Implemented. Update vault + memory.
- Manual smoke checklist (document): create project → add columns → add feature (appears in My Tasks) → check sub-tasks move the % → drag across a status-mapped column flips task status → file a request → promote → becomes a feature. Confirm a non-member can't see the project or its features.

---

## Notes / risks

- **RLS recursion:** `project_members` policies must only call `is_project_member`/`is_project_admin` (SECURITY DEFINER), never sub-select `project_members` inline. This is the #1 historical failure mode (hub_members).
- **Tasks SELECT policy:** add the project branch INLINE; do not reintroduce a STABLE-function-wrapped SELECT policy (migration 097).
- **Fractional pos rebalance:** when neighbor gap underflows, renormalize the column's positions (rare; handle in `moveFeature`).
- **Status ↔ column:** forward sync only (column→status on drop). No reverse auto-move in v1.
- **Externals:** blocked at project insert RLS + nav hidden + `is_external_user()` checks.
