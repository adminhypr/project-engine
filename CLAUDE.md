# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Engine is an internal task management web app. Users authenticate via Google OAuth through Supabase, get assigned roles (Staff/Manager/Admin), and manage tasks within teams. Priority colors are calculated live from timestamps (never stored). Assignment types (Superior/Peer/CrossTeam/Upward/Self) are stored at task creation time.

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
- **Data layer:** `useTasks` hook handles fetching, real-time subscriptions, and task enrichment (priority calculation). `useTaskActions` provides `assignTask`, `updateTask`, `addComment`, `getTaskComments`, `acceptTask`, `declineTask`, `reassignTask`. `useProfiles` fetches all users and teams.
- **Priority engine:** `getPriority()` in `src/lib/priority.js` computes red/orange/yellow/green from due dates or last-updated timestamps. Always computed at read time, never persisted. Thresholds: red = overdue or 36h+ inactive, orange = due in 4-12h, yellow = due in 12-24h, green = on track.
- **Multi-team membership:** Users can belong to multiple teams via `profile_teams` junction table. One team is marked `is_primary`. `profiles.team_id` is kept in sync as a denormalized primary. Profiles are enriched with `team_ids` (array) and `all_teams` (with names). Settings page uses chip UI for team management. Assign page shows team picker when assignee has 2+ teams.
- **Assignment type:** `getAssignmentType()` in `src/lib/assignmentType.js` compares role ranks (Admin=3, Manager=2, Staff=1) and team membership (shares any team = same team). Stored on the task record at creation; reassignments don't change the original type.
- **Acceptance flow:** Superior and Self assignments auto-accept via DB trigger (before insert). Peer/CrossTeam/Upward default to Pending. Reassignment resets acceptance to Pending.
- **Row Level Security:** Supabase RLS policies enforce data access — managers see own team + users who report to them, staff see own + assigned tasks.
- **Real-time:** Single `postgres_changes` subscription on `tasks` table triggers full refetch (simpler than fine-grained updates). Comments use the same pattern.
- **No global state:** No Redux/Zustand. Auth context + Supabase Realtime + component state.
- **Filtering:** `applyFilters()` in `src/lib/filters.js` is shared across all pages. Filters by status, urgency, priority, team, acceptance, with full-text search across title, task_id, names.
- **Theme:** `useTheme` hook persists dark/light in localStorage (`pe-theme`), falls back to `prefers-color-scheme`. Tailwind uses `darkMode: 'class'` strategy.
- **UI system:** Shared CSS component classes (`.btn`, `.btn-primary`, `.card`, `.form-input`, `.badge`, `.priority-red/orange/yellow/green`, etc.) defined in `src/index.css`. Custom Tailwind shadows (`shadow-soft`, `shadow-card`, `shadow-elevated`, `shadow-panel`) in `tailwind.config.js`. Reusable Framer Motion animation components (`FadeIn`, `SlidePanel`, `PageTransition`, `ModalWrapper`, etc.) in `src/components/ui/animations.jsx`. Shared components (`PageHeader`, `StatsStrip`, `PriorityBadge`, `FilterRow`, `showToast`, etc.) in `src/components/ui/index.jsx`. Icons from `lucide-react`.
- **Toast system:** `showToast(message, type)` is imperative — creates DOM elements directly, no React state. Auto-removes after 2.7s.
- **Routing:** React Router v6. Root `/` redirects to `/my-tasks`. Routes wrapped with `AnimatePresence` for page transitions. `ErrorBoundary` wraps all routes.
- **Notifications:** `NotificationBell` component shows real-time in-app notifications for pending acceptance, overdue tasks, and recent assignments.

## Critical Gotchas

- **PostgREST FK hints are required.** The `profile_teams` junction table creates ambiguity for PostgREST when joining `profiles` to `teams`. Always use explicit FK hints: `teams!profiles_team_id_fkey(id,name)` for legacy single-team, `teams!profile_teams_team_id_fkey(id,name)` for multi-team. Similarly, tasks use `profiles!tasks_assigned_to_fkey(...)` and `profiles!tasks_assigned_by_fkey(...)`. Omitting hints causes 300-level ambiguity errors.
- **Profile enrichment must fall back to legacy `team_id`.** Both `useAuth`, `useTasks`, and `useProfiles` fetch `profile_teams` separately then fall back: `team_ids: pt.length > 0 ? pt.map(...) : (p.team_id ? [p.team_id] : [])`. This handles users who haven't been backfilled into the junction table. Skipping the fallback causes managers to see zero team tasks.
- **Empty `profile_teams` array breaks manager RLS.** If a manager's `profile_teams` rows are missing, the `= ANY(...)` RLS check returns no rows. The app works around this with a fallback query using `profiles.team_id` when the array is empty.

## Database

Schema across 5 migrations in `supabase/migrations/`:

- **001_initial.sql** — `profiles`, `teams`, `tasks`, `comments` tables. Auto-creates profile on first login. `last_updated` auto-updates via trigger. `email_alert_sent` resets on status change.
- **002_audit_log.sql** — `task_audit_log` table. Events: task_created, status_changed, urgency_changed, due_date_changed, notes_updated, reassigned, accepted, declined, assigner_override. Write-only via service role triggers.
- **003_acceptance.sql** — Adds `acceptance_status`, `decline_reason`, `accepted_at`, `declined_at` to tasks. Auto-accept logic enforced by DB trigger.
- **004_reports_to.sql** — Adds `reports_to` FK on profiles. RLS updated so managers see tasks of users who report to them.
- **005_task_icon.sql** — Adds optional `icon` text column to tasks for visual categorization.
- **006_task_delete.sql** — Adds delete RLS policy for tasks (admins, managers for own team, assignee/assigner).
- **007_multi_team.sql** — `profile_teams` junction table for multi-team membership. Backfills from `profiles.team_id`. Updates all RLS policies to use `profile_teams` for manager team checks. `profiles.team_id` kept as denormalized primary team.

## Supabase Edge Functions

Both are Deno-based and use Resend for email delivery:

- **`supabase/functions/notify/`** — Triggered by database webhooks on task INSERT/UPDATE. Sends transactional emails for: task assigned (skips self-assignments), task declined (with reason), task completed, task reassigned.
- **`supabase/functions/send-alerts/`** — Scheduled cron (every 2h). Sends red alerts (overdue/inactive) to assignee + manager CC, and due reminders at 4h/24h milestones. `email_alert_sent` flag prevents duplicate red alerts.

## Environment Variables

Required in `.env.local`:
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon public key

## Role Hierarchy and Views

- **Staff:** My Tasks, Assign a Task
- **Manager:** Above + Team View (all assigned teams), own-teams Reports
- **Admin:** Everything + Admin Overview, all Reports, Settings (user/team management)

`isManager` in useAuth returns true for both Manager and Admin roles.

## Testing

Vitest + React Testing Library with jsdom. Tests live in `src/lib/__tests__/`:
- `priority.test.js` — Due date thresholds, inactivity, precedence rules
- `assignmentType.test.js` — All role/team combinations
- `helpers.test.js` — Task ID format, date formatting
- `filters.test.js` — All filter types, search, combinations
- `acceptance.test.js` — Acceptance logic, reassignment resets
