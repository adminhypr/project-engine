# Project Dev Board (Trello-style) — Design

**Date:** 2026-06-25
**Status:** Approved (brainstorm complete). Implementation plan: `2026-06-25-project-dev-board.md`. No code yet.

## Goal

A developer project-management view: **Project → Features (with % completion, status, owner, due date) → Feature Request backlog**. Trello-style board, but Features are **real tasks** (they appear in My Tasks / Team View like everything else). The board is a richer *lens* over tasks, not a parallel system.

## Locked decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| What is a "Project"? | A new **lightweight `projects` entity** (not a Hub, not a parent task). |
| Project visibility | **Explicit membership** (`project_members`, like custom Hubs). Externals excluded. |
| What is a "Feature"? | **A task** tagged with `project_id`. Shows in My Tasks / Team View natively. |
| % completion | **Auto from sub-tasks** (done ÷ total). Fallback when no sub-tasks: status (Not Started 0%, In Progress shows dash, Done 100%). |
| Feature Requests | **Separate `feature_requests` backlog** with its own status; **promotable** into a Feature task. |
| Board engine | **Trello-true: freeform per-project lists** (`project_columns`), each card a task, lists optionally map to a task status. |
| Boards | Two: **Features board** (by column) + **Feature Requests board** (by request status). List ⇄ Board toggle per user. |
| Placement | New top-level **`/projects`** route + nav item (internal users only). |
| Labels | **Phase 2** (board-scoped `project_labels` + junction). Out of v1. |

## Why this shape

- Tasks stay the single source of truth — Features inherit task RLS, assignment, notifications, audit, chat, sub-tasks, archive, the works.
- The existing **Card Table** (migrations 069–072) is already a Trello clone, but its cards are deliberately **not tasks** (they never hit My Tasks / escalation / task email). The hard requirement "a Feature is a task" rules out reusing Card Table cards, so the board is built on tasks instead — borrowing Card Table's *UI patterns* (dnd-kit board, card modal, column CRUD) re-pointed at tasks.
- Explicit membership was chosen for control; it carries the codebase's #1 RLS hazard (`hub_members` recursion — fixed in migrations 013/017/018/093/103), so `project_members` uses the proven **SECURITY DEFINER helper** pattern from day one.

## Data model

```
projects
  id uuid pk, name text, description text,
  status text  ∈ Active · On Hold · Completed · Archived  (default Active),
  target_date date null,           -- project-level due date
  created_by uuid, created_at timestamptz

project_members                    -- explicit membership (hub_members pattern)
  project_id uuid, profile_id uuid,
  role text ∈ owner · admin · member,
  created_at timestamptz
  primary key (project_id, profile_id)

project_columns                    -- the Trello "lists" (freeform, per project)
  id uuid pk, project_id uuid,
  name text, color text, pos double precision,   -- fractional ordering
  maps_to_status text null  ∈ Not Started · In Progress · Blocked · Done,
  created_at timestamptz

feature_requests                   -- the backlog
  id uuid pk, project_id uuid,
  title text, description text, requester_id uuid,
  status text ∈ Requested · Under Review · Planned · Rejected · Promoted (default Requested),
  promoted_task_id uuid null references tasks(id) on delete set null,
  pos double precision, created_at timestamptz

-- tasks gains three nullable columns (a "Feature" = a task with project_id set):
tasks.project_id        uuid null references projects(id)        on delete set null
tasks.project_column_id uuid null references project_columns(id) on delete set null
tasks.project_pos       double precision null                    -- board order within column
```

Cascades: `project → members/columns/feature_requests` = `on delete cascade`. `tasks.project_id` / `project_column_id` = `on delete set null` (deleting a project or list orphans features back to plain tasks rather than deleting them).

## RLS (recursion-safe by construction)

- **Helpers (SECURITY DEFINER, STABLE):** `is_project_member(p_project)`, `is_project_admin(p_project)` — do the `project_members` lookup so **no policy on `project_members` ever sub-selects `project_members`** (the exact shape that caused the hub cycles).
- `projects` / `project_members` / `project_columns` / `feature_requests` SELECT → `is_project_member`. Manage (insert/update/delete of columns, members, project settings) → `is_project_admin`. Member self-insert only on the empty-project creator path (migration-074 pattern).
- **Tasks visibility — ONE inline branch added** to the existing tasks SELECT predicate:
  `OR (project_id IS NOT NULL AND is_project_member(project_id))`.
  Written **inline** (NOT via a STABLE-function wrapper on the SELECT policy — migration 097 showed that breaks `INSERT … RETURNING`). This single branch makes the board, the existing `TaskDetailPanel`, sub-tasks, comments and chat all "just work" for project members through normal queries. My Tasks / Team View are unaffected (they still filter by assignee / manager).

## Writes

- **Board move (drag a card):** `move_feature(p_task, p_column, p_pos)` SECURITY DEFINER RPC, gated on `is_project_member`. Updates `project_column_id` + `project_pos`, and if the target column has `maps_to_status`, syncs `tasks.status` (reusing the existing status-change machinery). Single writer for board position → lets any member rearrange the board without a blanket task-UPDATE grant. (Status→column reverse-sync is intentionally NOT automatic in v1.)
- **Add feature:** creates a task with `project_id` + first/Backlog column (normal task insert; creator is assigner so task RLS allows it). Routes through the existing assign flow / a slim inline add.
- **Promote request:** `promote_request(p_request, p_assignee?, p_due?)` SECURITY DEFINER RPC → inserts a Feature task (project_id, Backlog column), sets `feature_requests.status = Promoted` + `promoted_task_id`.
- **Deeper feature edits** (sub-tasks, assignees, status dropdown, comments) keep **normal task permissions** via the existing `TaskDetailPanel`.

## UX

**`/projects`** — list of projects you're a member of: name, status badge, target date, overall progress (avg of feature %s), feature count, member avatars. "New Project" (any internal user → becomes owner).

**`/projects/:id`** — header (name, status, target date, members, edit for admins) + **List ⇄ Board toggle** (persisted per user, like task pages), over two sections:

- **Features**
  - *List:* rows of `title · ▓▓▓░ 60% · status · @owner · due`. Click → existing `TaskDetailPanel`. "Add Feature".
  - *Board:* Trello columns = `project_columns`. Cards = features showing title, % bar, owner, due. Drag between/within lists via `@dnd-kit` (fractional `pos`); drop into a status-mapped list syncs task status. Owner/admin manage lists (add/rename/recolor/reorder, set `maps_to_status`).
- **Feature Requests**
  - *List:* grouped by status, each with requester + status dropdown + **Promote →**.
  - *Board:* triage kanban, columns = request statuses (Requested · Under Review · Planned · Rejected · Promoted), drag updates `feature_requests.status`.

**Reuse:** features render through existing task components; card modal = `TaskDetailPanel`; checklist progress = sub-tasks. Net-new UI = project shell, the % bar, the freeform board (adapted from Card Table), the requests board.

## Trello implementation notes (from research)

- **Fractional `pos` floats** for `project_columns.pos` and `tasks.project_pos`: a drag rewrites only the moved row (no cascading renumber). Compute new pos = midpoint of neighbors; periodic/normalize rebalance when gaps get tiny.
- **`@dnd-kit`** (already in the stack for todos + module order). Mind the known insert-above/below direction edge case when dropping near a card boundary.
- **% from checklist** = sub-tasks done/total (existing `completionProgress` helper shape).
- **Labels** (board-scoped `project_labels` + `task_labels` junction, à la Trello's reusable color+name labels) = **phase 2**.

Sources: Trello Object Definitions; Trello REST API (Cards); dnd-kit multi-list board pattern.

## Out of scope (v1, YAGNI)

- Labels, card covers, custom fields, power-ups.
- Status→column reverse auto-sync.
- Cross-project / portfolio rollups.
- Externals (Agent/Client) on the dev board.
- Reusing/merging with the existing Card Table data.

## Pure-logic units (TDD targets)

- `fractionalPos(before, after)` — midpoint ordering + rebalance signalling.
- `featureProgress(task)` — sub-tasks done/total → %, with status fallback.
- `projectProgress(features)` — average of feature %s.
- `groupFeaturesByColumn(features, columns)` / `groupRequestsByStatus(requests)`.

## Verification gates

- `npm run test:run` (pure-logic), `npm run build`.
- Manual UI smoke (headless OAuth unavailable).
- Migrations applied to Supabase before the feature is usable.
