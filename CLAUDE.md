# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Engine is an internal task management web app. Users authenticate via Google OAuth through Supabase, get assigned roles (Staff/Manager/Admin), and manage tasks within teams. Priority colors are calculated live from timestamps (never stored). Assignment types (Superior/Peer/CrossTeam/Upward/Self) are stored at task creation time.

## Commands

- `npm run dev` — Start dev server (http://localhost:5173)
- `npm run build` — Production build
- `npm run preview` — Preview production build
- `npm test` — Run all tests (Vitest)
- `npm test -- src/lib/__tests__/priority.test.js` — Run a single test file

## Architecture

**Stack:** React 18 + Vite, Tailwind CSS, Framer Motion, Supabase (Postgres + Auth + Realtime), Recharts, deployed on Vercel.

**Path alias:** `@` maps to `/src` (configured in vite.config.js).

**Key architectural patterns:**

- **Auth flow:** `useAuth` hook (React Context) wraps the app. Provides `session`, `profile`, `isAdmin`, `isManager`, `isStaff`. Uses a custom REST fetch (`fetchProfileDirect`) to bypass the Supabase JS client's auth queue, with token expiration checks and auto-refresh retry logic.
- **Data layer:** `useTasks` hook handles fetching, real-time subscriptions, and task enrichment (priority calculation). `useTaskActions` provides `assignTask`, `updateTask`, `addComment`, `getTaskComments`, `acceptTask`, `declineTask`, `reassignTask`. `useProfiles` fetches all users and teams.
- **Priority engine:** `getPriority()` in `src/lib/priority.js` computes red/orange/yellow/green from due dates or last-updated timestamps. Always computed at read time, never persisted. Thresholds: red = overdue or 36h+ inactive, orange = due in 4-12h, yellow = due in 12-24h, green = on track.
- **Assignment type:** `getAssignmentType()` in `src/lib/assignmentType.js` compares role ranks (Admin=3, Manager=2, Staff=1) and team membership. Stored on the task record at creation; reassignments don't change the original type.
- **Acceptance flow:** Superior and Self assignments auto-accept via DB trigger (before insert). Peer/CrossTeam/Upward default to Pending. Reassignment resets acceptance to Pending.
- **Row Level Security:** Supabase RLS policies enforce data access — managers see own team + users who report to them, staff see own + assigned tasks.
- **Real-time:** Single `postgres_changes` subscription on `tasks` table triggers full refetch (simpler than fine-grained updates). Comments use the same pattern.
- **No global state:** No Redux/Zustand. Auth context + Supabase Realtime + component state.
- **Filtering:** `applyFilters()` in `src/lib/filters.js` is shared across all pages. Filters by status, urgency, priority, team, acceptance, with full-text search across title, task_id, names.
- **Theme:** `useTheme` hook persists dark/light in localStorage (`pe-theme`), falls back to `prefers-color-scheme`. Tailwind uses `darkMode: 'class'` strategy.

## Database

Schema across 4 migrations in `supabase/migrations/`:

- **001_initial.sql** — `profiles`, `teams`, `tasks`, `comments` tables. Auto-creates profile on first login. `last_updated` auto-updates via trigger. `email_alert_sent` resets on status change.
- **002_audit_log.sql** — `task_audit_log` table. Events: task_created, status_changed, urgency_changed, due_date_changed, notes_updated, reassigned, accepted, declined, assigner_override. Write-only via service role triggers.
- **003_acceptance.sql** — Adds `acceptance_status`, `decline_reason`, `accepted_at`, `declined_at` to tasks. Auto-accept logic enforced by DB trigger.
- **004_reports_to.sql** — Adds `reports_to` FK on profiles. RLS updated so managers see tasks of users who report to them.

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
- **Manager:** Above + Team View (own team only), own-team Reports
- **Admin:** Everything + Admin Overview, all Reports, Settings (user/team management)

`isManager` in useAuth returns true for both Manager and Admin roles.

## Testing

Vitest + React Testing Library with jsdom. Tests live in `src/lib/__tests__/`:
- `priority.test.js` — Due date thresholds, inactivity, precedence rules
- `assignmentType.test.js` — All role/team combinations
- `helpers.test.js` — Task ID format, date formatting
- `filters.test.js` — All filter types, search, combinations
- `acceptance.test.js` — Acceptance logic, reassignment resets
