# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Engine is an internal task management web app. Users authenticate via Google OAuth through Supabase, get assigned roles (Staff/Manager/Admin), and manage tasks within teams. Priority colors are calculated live from timestamps (never stored). Assignment types (Superior/Peer/CrossTeam/Upward/Self) are stored at task creation time.

In addition to task management, the app hosts **Project Hubs** — Basecamp-style collaboration spaces with chat (Campfire), message board, check-ins, shared calendar, and docs & files. Hubs can be team-scoped or independent (custom hubs with explicit membership).

## Commands

- `npm run dev` — Start dev server (http://localhost:5173)
- `npm run build` — Production build
- `npm run preview` — Preview production build
- `npm test` — Run all tests in watch mode (Vitest)
- `npm run test:run` — Run all tests once (no watch)
- `npm run test:coverage` — Run tests with coverage report
- `npm test -- src/lib/__tests__/priority.test.js` — Run a single test file

## Architecture

**Stack:** React 18 + Vite, Tailwind CSS, Framer Motion, Supabase (Postgres + Auth + Realtime), Recharts, deployed on Vercel.

**Path alias:** `@` maps to `/src` (configured in vite.config.js).

**Key architectural patterns:**

- **Auth flow:** `useAuth` hook (React Context) wraps the app. Provides `session`, `profile`, `isAdmin`, `isManager`, `isStaff`. Uses a custom REST fetch (`fetchProfileDirect`) to bypass the Supabase JS client's auth queue, with token expiration checks and auto-refresh retry logic.
- **Data layer:** `useTasks` hook handles fetching, real-time subscriptions, and task enrichment (priority calculation). `useTaskActions` provides `assignTask`, `updateTask`, `addComment`, `getTaskComments`, `acceptTask`, `declineTask`, `reassignTask`. `useProfiles` fetches all users and teams. `useAttachments` handles task file uploads to the `task-attachments` Storage bucket (5 MB max per file). `useAuditLog` provides task-specific event history and admin/manager report queries with date/team filtering.
- **Project Hubs data layer:** One hook per hub module — `useHubs` (list/create/join), `useHubMembers`, `useHubChat` (Campfire realtime), `useHubMessages` (threaded message board), `useHubCheckIns` (recurring prompts + responses), `useHubTodos` (named to-do lists with checkable items, multi-assignee, drag reorder) + `useHubTodoComments` (per-item discussion), `useHubEvents` (calendar), `useHubFiles` (docs & files with folder hierarchy), `useHubActivity` (aggregated feed), `useHubModuleOrder` (per-user drag-sorted module layout stored in `hub_members.module_order` JSONB), `usePresence` (who's online).
- **Priority engine:** `getPriority()` in `src/lib/priority.js` computes red/orange/yellow/green from due dates or last-updated timestamps. Always computed at read time, never persisted. Thresholds: red = overdue or 36h+ inactive, orange = due in 4-12h, yellow = due in 12-24h, green = on track.
- **Multi-team membership:** Users can belong to multiple teams via `profile_teams` junction table. One team is marked `is_primary`. `profiles.team_id` is kept in sync as a denormalized primary. Profiles are enriched with `team_ids` (array) and `all_teams` (with names). Settings page uses chip UI for team management. Assign page shows team picker when assignee has 2+ teams.
- **Per-team roles:** Users can have different roles (Staff/Manager) per team via `profile_teams.role`. Admin remains a global role on `profiles.role`. The profile's effective role is auto-synced as the max across all team roles (but never downgrades an Admin). `profile.team_roles` is a `{team_id: role}` map enriched at fetch time. Assignment type uses the assigner's role in the target team context.
- **Assignment type:** `getAssignmentType()` in `src/lib/assignmentType.js` compares role ranks (Admin=3, Manager=2, Staff=1) and team membership (shares any team = same team). Stored on the task record at creation; reassignments don't change the original type.
- **Multi-assignee tasks:** Tasks can have multiple assignees via the `task_assignees` junction table. `tasks.assigned_to` is kept as the "primary" assignee for backward compatibility with older queries, RLS, and email flows. New code should read from `task_assignees` when a complete list is needed.
- **Acceptance flow:** Superior and Self assignments auto-accept via DB trigger (before insert). Peer/CrossTeam/Upward default to Pending. Reassignment resets acceptance to Pending.
- **Row Level Security:** Supabase RLS policies enforce data access — managers see own team + users who report to them, staff see own + assigned tasks.
- **Real-time:** Single `postgres_changes` subscription on `tasks` table triggers full refetch (simpler than fine-grained updates). Comments use the same pattern.
- **No global state:** No Redux/Zustand. Auth context + Supabase Realtime + component state.
- **Filtering:** `applyFilters()` in `src/lib/filters.js` is shared across all pages. Filters by status, urgency, priority, team, acceptance, with full-text search across title, task_id, names.
- **Theme:** `useTheme` hook persists dark/light in localStorage (`pe-theme`), falls back to `prefers-color-scheme`. Tailwind uses `darkMode: 'class'` strategy.
- **UI system:** Shared CSS component classes (`.btn`, `.btn-primary`, `.card`, `.form-input`, `.badge`, `.priority-red/orange/yellow/green`, etc.) defined in `src/index.css`. Custom Tailwind shadows (`shadow-soft`, `shadow-card`, `shadow-elevated`, `shadow-panel`) in `tailwind.config.js`. Reusable Framer Motion animation components (`FadeIn`, `SlidePanel`, `PageTransition`, `ModalWrapper`, etc.) in `src/components/ui/animations.jsx`. Shared components (`PageHeader`, `StatsStrip`, `PriorityBadge`, `FilterRow`, `showToast`, etc.) in `src/components/ui/index.jsx`. Icons from `lucide-react`.
- **Toast system:** `showToast(message, type)` is imperative — creates DOM elements directly, no React state. Auto-removes after 2.7s.
- **Routing:** React Router v6. Root `/` redirects to `/my-tasks`. Routes wrapped with `AnimatePresence` for page transitions. `ErrorBoundary` wraps all routes.
- **@Mentions:** `RichInput` component (`src/components/ui/RichInput.jsx`) provides a rich textarea with inline @mention autocomplete and optional image uploads. Mention parsing/insertion utilities live in `src/lib/mentions.js`. `RichContentRenderer` renders stored content with highlighted @mention spans and inline images (signed Supabase URLs). Used in Campfire chat, message board, and check-in responses. Mentions are persisted in the `hub_mentions` table, which drives both email notifications (via `hub-mention-notify` edge function) and in-app notifications (via `useMentionNotifications` hook with realtime subscription).
- **Notifications:** `NotificationBell` component shows real-time in-app notifications for pending acceptance, overdue tasks, recent assignments, hub invites, and hub @mentions.
- **Hub RLS recursion:** Hub member visibility can easily trigger PostgREST recursion (policies that read `hub_members` inside `hub_members` policies). Migrations 013, 017, and 018 exist specifically to break these cycles — when adding hub policies, avoid self-referencing subqueries and prefer SECURITY DEFINER helper functions.

## Critical Gotchas

- **PostgREST FK hints are required.** The `profile_teams` junction table creates ambiguity for PostgREST when joining `profiles` to `teams`. Always use explicit FK hints: `teams!profiles_team_id_fkey(id,name)` for legacy single-team, `teams!profile_teams_team_id_fkey(id,name)` for multi-team. Similarly, tasks use `profiles!tasks_assigned_to_fkey(...)` and `profiles!tasks_assigned_by_fkey(...)`. Omitting hints causes 300-level ambiguity errors.
- **Profile enrichment must fall back to legacy `team_id`.** Both `useAuth`, `useTasks`, and `useProfiles` fetch `profile_teams` separately then fall back: `team_ids: pt.length > 0 ? pt.map(...) : (p.team_id ? [p.team_id] : [])`. This handles users who haven't been backfilled into the junction table. Skipping the fallback causes managers to see zero team tasks.
- **Empty `profile_teams` array breaks manager RLS.** If a manager's `profile_teams` rows are missing, the `= ANY(...)` RLS check returns no rows. The app works around this with a fallback query using `profiles.team_id` when the array is empty.

## Database

Schema in `supabase/migrations/` (apply in filename order):

**Core task system (001–013):**
- **001_initial.sql** — `profiles`, `teams`, `tasks`, `comments`. Auto-creates profile on first login. `last_updated` auto-updates via trigger. `email_alert_sent` resets on status change.
- **002_audit_log.sql** — `task_audit_log` table. Events: task_created, status_changed, urgency_changed, due_date_changed, notes_updated, reassigned, accepted, declined, assigner_override. Write-only via service role triggers.
- **003_acceptance.sql** — Adds `acceptance_status`, `decline_reason`, `accepted_at`, `declined_at`. Auto-accept logic enforced by DB trigger.
- **004_reports_to.sql** — Adds `reports_to` FK on profiles. Managers see tasks of users who report to them.
- **005_task_icon.sql** — Adds optional `icon` column on tasks.
- **006_task_delete.sql** — Delete RLS for tasks (admins, managers for own team, assignee/assigner).
- **007_multi_team.sql** — `profile_teams` junction. Backfills from `profiles.team_id`. Updates all RLS to use the junction.
- **008_manager_setup_users.sql** — Managers can add `profile_teams` rows and set `profiles.team_id` for unassigned users.
- **009_admin_edit_delete_users.sql** — Admin-only RLS for profile edit/delete.
- **010_per_team_role.sql** — Adds `role` column to `profile_teams`. Per-team Staff/Manager. `profiles.role` auto-syncs to the max but never downgrades Admin.
- **011_multi_assignee.sql** — `task_assignees` junction. `tasks.assigned_to` preserved as primary.
- **012_audit_log_performed_by.sql** — Adds `performed_by` to audit log so the UI can show who did each action.
- **013_fix_profile_teams_recursion.sql** — Breaks a policy recursion introduced by 007/010.

**Project Hubs (014–020):**
- **014_attachments.sql** — `task_attachments` table + `task-attachments` Storage bucket.
- **014_project_hub.sql** — Hub module board, check-ins, events, chat, activity feed. *(Shares the 014 prefix with the attachments migration — both applied in the same release.)*
- **015_hub_events_realtime.sql** — Enables realtime on hub event tables.
- **016_custom_hubs.sql** — Independent hubs with explicit membership, file/folder storage. Migrates existing `hub_*` tables from `team_id`-scoped to `hub_id`-scoped.
- **017_fix_hub_members_recursion.sql** / **018_fix_hub_creator_select.sql** — Break recursion in hub member visibility policies.
- **019_hub_module_order.sql** — `hub_members.module_order` JSONB for per-user drag-sorted module layout.
- **020_hub_team_id_nullable.sql** — Makes `team_id` nullable on hub tables (`hub_id` is the real FK) and adds missing hub-scoped INSERT/UPDATE/DELETE policies.
- **022_hub_todos.sql** — `hub_todo_lists`, `hub_todo_items`, `hub_todo_item_assignees`, `hub_todo_comments`. Named to-do lists with drag-sortable checkable items, multi-assignee, due dates, comments, and @mentions integration.

## Supabase Edge Functions

All are Deno-based and use Resend for email delivery:

- **`supabase/functions/notify/`** — Triggered by database webhooks on task INSERT/UPDATE. Sends transactional emails for: task assigned (skips self-assignments), task declined (with reason), task completed, task reassigned.
- **`supabase/functions/send-alerts/`** — Scheduled cron (every 2h). Sends red alerts (overdue/inactive) to assignee + manager CC, and due reminders at 4h/24h milestones. `email_alert_sent` flag prevents duplicate red alerts.
- **`supabase/functions/user-notify/`** — Called from the frontend via `supabase.functions.invoke()`. Sends user lifecycle emails: approval notifications and invite emails.
- **`supabase/functions/hub-mention-notify/`** — Triggered by database webhook on `hub_mentions` INSERT. Sends email to mentioned users with a message preview and hub link via Resend.
- **`supabase/functions/admin-delete-user/`** — Admin-only. Deletes a user from `auth.users` (cascades to profiles, tasks, comments). Requires service role.

## Environment Variables

Required in `.env.local`:
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon public key

## Role Hierarchy and Views

- **Staff:** My Tasks, Assign a Task, Hubs they belong to
- **Manager:** Above + Team View (all assigned teams), own-teams Reports, limited Settings (set up unassigned users on their teams)
- **Admin:** Everything + Admin Overview, all Reports, Settings (full user/team management, edit/delete users)

`isManager` in useAuth returns true for both Manager and Admin roles. Hub access is independent of the task-side role — membership is determined by `hub_members`, and a Staff user can be a hub creator/admin.

## Testing

Vitest + React Testing Library with jsdom. Tests live in `src/lib/__tests__/`:
- `priority.test.js` — Due date thresholds, inactivity, precedence rules
- `assignmentType.test.js` — All role/team combinations
- `helpers.test.js` — Task ID format, date formatting
- `filters.test.js` — All filter types, search, combinations
- `acceptance.test.js` — Acceptance logic, reassignment resets
