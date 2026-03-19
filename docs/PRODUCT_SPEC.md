# Project Engine — Product Specification
*Developer handoff document — read this first*

---

## Overview

A web-based internal task management system for a company on Google Workspace. Anyone can assign tasks to anyone else. The system tracks urgency, deadlines, comments, and productivity metrics. One URL, Google OAuth login, role-aware views.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS |
| Auth | Supabase Auth with Google OAuth |
| Database | Supabase (PostgreSQL) |
| Real-time | Supabase Realtime (comments, task updates) |
| Charts | Recharts |
| CSV Export | papaparse |
| Hosting | Vercel |
| Email Alerts | Supabase Edge Functions (cron) |

---

## User Roles

| Role | Rank | What they see |
|---|---|---|
| Staff | 1 | My Tasks + Assign a Task |
| Manager | 2 | Above + their Team View |
| Admin | 3 | Everything + Admin Overview + All Reports |

Managers can only see reports for their own team.
Admins see org-wide reports.

---

## Assignment Type Logic

When a task is assigned, the system compares assigner rank vs assignee rank:

| Scenario | Type | Badge Color |
|---|---|---|
| Admin → anyone | Superior | White/gray |
| Manager → own team Staff | Superior | White/gray |
| Same rank, same team | Peer | Blue |
| Any cross-team assignment | CrossTeam | Strong blue |
| Lower rank → higher rank | Upward | Purple |
| Self-assignment | Self | Gray |

Assignment Type is a badge on the task card. It does NOT affect row color.

---

## Priority Engine

Row color is determined by urgency/time. Calculated live, never stored.

**With Due Date:**
- Green = >24h remaining
- Yellow = 12-24h remaining
- Orange = 0-12h remaining
- Red = Overdue

**Without Due Date (inactivity):**
- Green = updated <12h ago
- Yellow = 12-24h ago
- Orange = 24-36h ago
- Red = >36h no update

---

## Views

### My Tasks (all roles)
- Stats strip: red count, urgent count, done, total
- Task table with priority color rows
- Filters: status, urgency, search
- Click any row opens detail panel

### Assign a Task (all roles)
- Assign To dropdown (all users in system)
- Task description, Urgency, Due Date, Who It's For, Notes
- Assigned By auto-filled from logged-in user
- Assignment Type auto-calculated and shown after submit

### Team View (Manager + Admin)
- All tasks for manager's team grouped by assignee
- Manager can update any task status in their team
- Admin sees all teams with color-coded team group headers

### Admin Overview (Admin only)
- Org-wide stats
- Team breakdown table
- Full task list, all filters

### Reports (Manager = own team, Admin = all)
Full reporting suite — see Reports section below.

### Settings (Admin only)
- User management: assign roles and teams to new sign-ups
- Team management: create/rename teams

---

## Task Detail Panel

Slides in from right on row click. Contains:
- All task metadata
- Date Assigned (never changes) — separate from Last Updated
- Status update + save
- Notes (editable)
- Full threaded comment history (newest first)
- Add comment input with real-time update

---

## Reports Module

All reports include:
- Custom date range picker
- Export to CSV
- Charts via Recharts

### Report 1 — Tasks by Team
Bar chart + table: open / completed / overdue / blocked per team, completion rate %

### Report 2 — Workload by Person
Table per person: tasks assigned to them, outstanding, completed, blocked, avg completion time. Flag high outstanding counts.

### Report 3 — Who Assigns to Whom
Matrix heatmap: assigners (rows) vs assignees (columns), cell = task count. Reveals cross-team patterns.

### Report 4 — Assignment Type Breakdown
Donut chart + table: Superior vs Peer vs CrossTeam vs Upward, by count and %, per team, trend over time.

### Report 5 — Productivity per Person
Per person: tasks received, tasks assigned to others, completed, completion rate %, avg days to complete, current outstanding, longest outstanding task. Flag <50% completion in red.

### Report 6 — Overdue Tasks
Full list: task, assigned to, team, assigned by, due date, days overdue, urgency. Sortable by days overdue. CSV export.

### Report 7 — Upcoming Tasks
Tasks due this week / this month / custom range. Sorted by due date, color coded by proximity.

### Report 8 — Completed Tasks Over Time
Line chart: completions per day/week/month (toggle). Filter by team or person. Shows productivity trends.

### Report 9 — Comment Activity
Who comments most, on which tasks. Most commented tasks top 10. Zero-comment tasks (potentially forgotten).

### Report 10 — Priority Distribution Over Time
Stacked area chart: % of tasks in each priority state per week. Shows if org is getting more or less on top of things.

---

## Email Alerts

Supabase Edge Function on 4-hour cron:
- Finds RED tasks where email_alert_sent = false
- Emails the assigned user, CC's their manager
- Sets email_alert_sent = true
- Resets when task status is updated (re-arms alert for next red incident)

---

## Database Tables

See /supabase/migrations/001_initial.sql for full schema.

- profiles: user identity, role, team
- teams: team definitions
- tasks: all task data
- comments: threaded comments per task

---

## Environment Variables

VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

---

## Deployment

1. Create Supabase project
2. Run SQL migration in Supabase SQL editor
3. Enable Google OAuth in Supabase Auth (needs Google Cloud OAuth credentials)
4. Push repo to GitHub
5. Connect to Vercel, add env vars, deploy

## Google OAuth Setup
1. console.cloud.google.com — create OAuth 2.0 credentials
2. Authorized redirect URI: https://[project].supabase.co/auth/v1/callback
3. Paste Client ID + Secret into Supabase Auth > Providers > Google

## Adding New Team Members
1. They open the app and sign in with Google (auto-creates profile)
2. Admin goes to Settings > Users, assigns them a team and role
3. Done — they see their role-appropriate view immediately
