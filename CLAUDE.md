# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Project Engine is an internal task management web app. Users authenticate via Google OAuth through Supabase, get assigned roles (Staff/Manager/Admin), and manage tasks within teams. Priority colors are calculated live from timestamps (never stored). Assignment types (Superior/Peer/CrossTeam/Upward/Self) are stored at task creation time.

## Commands

- `npm run dev` — Start dev server (http://localhost:5173)
- `npm run build` — Production build
- `npm run preview` — Preview production build

No test runner or linter is configured.

## Architecture

**Stack:** React 18 + Vite, Tailwind CSS, Supabase (Postgres + Auth + Realtime), Recharts, deployed on Vercel.

**Path alias:** `@` maps to `/src` (configured in vite.config.js).

**Key architectural patterns:**

- **Auth flow:** `useAuth` hook (React Context) wraps the app. Provides `session`, `profile`, `isAdmin`, `isManager`, `isStaff`. All routes are inside `AuthProvider` in App.jsx.
- **Data layer:** `useTasks` hook handles fetching, real-time subscriptions, and task enrichment (priority calculation). `useTaskActions` provides `assignTask`, `updateTask`, `addComment`, `getTaskComments`. `useProfiles` fetches all users and teams.
- **Priority engine:** `getPriority()` in `src/lib/supabase.js` computes red/orange/yellow/green from due dates or last-updated timestamps. This is always computed at read time, never persisted.
- **Assignment type:** `getAssignmentType()` in `src/lib/supabase.js` compares role ranks (Admin=3, Manager=2, Staff=1) and team membership. Stored on the task record at creation.
- **Row Level Security:** Supabase RLS policies enforce data access at the database level — managers truly cannot query tasks outside their team.
- **Real-time:** Supabase Realtime channels on the `tasks` table trigger refetches. Comments use the same pattern.
- **No global state:** No Redux/Zustand. Auth context + Supabase Realtime + component state.

**Database tables** (schema in `supabase/migrations/001_initial.sql`): `profiles`, `teams`, `tasks`, `comments`.

**Supabase Edge Functions:** `supabase/functions/send-alerts/` — optional cron for red-task email alerts.

## Environment Variables

Required in `.env.local`:
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon public key

## Role Hierarchy and Views

- **Staff:** My Tasks, Assign a Task
- **Manager:** Above + Team View (own team only), own-team Reports
- **Admin:** Everything + Admin Overview, all Reports, Settings (user/team management)

`isManager` in useAuth returns true for both Manager and Admin roles.
