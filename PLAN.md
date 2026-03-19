# PLAN.md — Project Engine Execution Plan

## Platforms & Tools Involved

| Tool | Purpose | Where |
|---|---|---|
| **React 18** | Frontend UI framework | `src/` — all `.jsx` files |
| **Vite 5** | Dev server + build tool | `vite.config.js`, `npm run dev/build` |
| **Tailwind CSS 3** | Utility-first styling | `tailwind.config.js`, `src/index.css` |
| **Supabase** | Backend-as-a-service (Postgres, Auth, Realtime, Edge Functions) | `supabase/`, `src/lib/supabase.js` |
| **Supabase Auth + Google OAuth** | Authentication via Google Workspace | Configured in Supabase dashboard + Google Cloud Console |
| **Supabase Realtime** | Live task/comment updates via WebSocket | `src/hooks/useTasks.js` channel subscriptions |
| **Supabase Edge Functions** | Deno-based serverless functions (email alerts) | `supabase/functions/send-alerts/index.ts` |
| **Supabase RLS** | Row Level Security policies in Postgres | `supabase/migrations/001_initial.sql` |
| **Recharts** | Charts for reports module | `src/pages/ReportsPage.jsx` |
| **PapaParse** | CSV export | `src/lib/supabase.js` → `exportToCSV()` |
| **Lucide React** | Icon library | Used across all components |
| **React Router DOM 6** | Client-side routing | `src/App.jsx` |
| **date-fns** | Date utilities (installed but not currently imported — `supabase.js` uses raw Date) |
| **Vercel** | Production hosting | Deployment target |
| **Vitest** | Test runner (to be added) | TDD setup — Phase 0 |
| **React Testing Library** | Component testing (to be added) | TDD setup — Phase 0 |

| **Framer Motion** | Animation library for React (to be added) | Transitions, confirmations, panel slides, toasts |

---

## Design System — "HY Glass"

Brand-aligned, Apple-inspired glassmorphism theme applied across the entire UI.

### Brand Palette (extracted from HY logo)

| Token | Hex | Usage |
|---|---|---|
| `navy-900` | `#1a2744` | Sidebar bg, primary text, headings |
| `navy-800` | `#243252` | Sidebar hover states, card borders |
| `navy-700` | `#2e3f63` | Secondary text, subtle borders |
| `navy-50` | `#f0f2f7` | Page background (replaces gray-50) |
| `orange-500` | `#d4762c` | Primary accent — CTAs, active states, links |
| `orange-600` | `#b8632a` | Hover state for primary buttons |
| `orange-400` | `#e89044` | Lighter accent — badges, highlights |
| `orange-50` | `#fef5ee` | Accent backgrounds |
| `white` | `#ffffff` | Cards, glass surfaces |
| `glass-bg` | `rgba(255,255,255,0.7)` | Frosted glass card backgrounds |
| `glass-border` | `rgba(255,255,255,0.2)` | Glass element borders |

Priority row colors remain (red/orange/yellow/green) but adapt to the glass style with translucent backgrounds.

### Glassmorphism Principles

- **Cards:** `backdrop-blur-xl bg-white/70 border border-white/20 shadow-lg shadow-navy-900/5`
- **Sidebar:** Solid `navy-900` with subtle inner glass panels for user info
- **Modals/Panels:** `backdrop-blur-2xl bg-white/80` with soft drop shadows
- **Inputs:** `bg-white/50 border-navy-700/20 focus:border-orange-500 focus:ring-orange-500/20`
- **Buttons primary:** `bg-orange-500 hover:bg-orange-600 text-white` with press scale animation
- **Buttons secondary:** `bg-white/60 backdrop-blur border-navy-700/15 hover:bg-white/80`
- **Toasts:** `backdrop-blur-xl bg-navy-900/90 text-white` floating with entrance animation

### Animation System (Framer Motion)

| Element | Animation | Details |
|---|---|---|
| **Page transitions** | Fade + slide up | `opacity 0→1, y 8→0`, 200ms ease-out |
| **Cards on mount** | Staggered fade-in | Each card delays 50ms, `opacity 0→1, y 12→0` |
| **Task detail panel** | Slide from right | `x 100%→0`, spring physics (stiffness: 300, damping: 30) |
| **Modals** | Scale + fade | `scale 0.95→1, opacity 0→1`, 150ms |
| **Overlay backdrop** | Fade in | `opacity 0→1`, 200ms |
| **Button press** | Scale down | `whileTap={{ scale: 0.97 }}` |
| **Button hover** | Subtle lift | `whileHover={{ y: -1 }}` |
| **Toast notifications** | Slide up + fade | Enter from bottom with spring, exit fade out |
| **Accept action** | Green pulse + checkmark | Success burst animation, scale 1→1.1→1 with green glow |
| **Decline action** | Red shake + fade | Horizontal shake (x: [-4, 4, -4, 0]) then card fades to muted |
| **Task reassigned** | Orange slide-swap | Old assignee slides left out, new slides right in |
| **Status change** | Badge morph | Color cross-fade between old and new status color |
| **Stats strip numbers** | Count up | Animated number counting from 0 to value on mount |
| **Sidebar nav** | Active indicator slide | Orange left-border indicator animates between items via `layoutId` |
| **Loading states** | Skeleton shimmer | Navy-50 to white gradient sweep, glass-styled skeleton cards |
| **Audit log timeline** | Staggered reveal | Each event fades in from left, 30ms stagger |
| **Acceptance banner** | Gentle bounce-in | `y -20→0` with spring, persistent subtle pulse on count badge |
| **Row hover** | Lift + glow | `y: -1, shadow` increase, 150ms transition |
| **Filter changes** | Layout animation | Table rows animate position changes when filters update |

### Implementation Approach

Added as **Phase 0F** — runs parallel with file cleanup since it touches `tailwind.config.js`, `index.css`, and every component.

Steps:
1. Install `framer-motion`
2. Update `tailwind.config.js` — replace color palette with brand tokens, add glass utilities
3. Rewrite `index.css` — new base layer with glass component classes
4. Create `src/components/ui/animations.jsx` — reusable motion wrappers (`FadeIn`, `SlidePanel`, `StaggerChildren`, `AnimatedNumber`, `SuccessBurst`, `ShakeReject`)
5. Update `Layout.jsx` — navy sidebar, animated nav indicator
6. Update `LoginPage.jsx` — full glass treatment on login card
7. Update all UI components (`index.jsx`) — glass cards, new button styles, animated toast
8. Update `TaskDetailPanel.jsx` — spring slide-in, animated status changes
9. Update `TaskTable.jsx` — row hover animations, layout animations on filter
10. Update all page components — page transition wrappers, staggered card mounts, animated stat numbers
11. Update `ReportsPage.jsx` (and split reports) — glass cards, chart container animations

---

## Current State Assessment

### What exists (17 files, ~2,200 lines)
- Full working app: auth, task CRUD, real-time updates, 10 reports, admin settings
- Database schema with RLS, triggers, indexes
- Email alert edge function (placeholder — no real email provider wired in)

### What needs work

**File organization issues:**
- `src/lib/supabase.js` (161 lines) — single file containing Supabase client, auth helpers, priority engine, assignment type logic, task ID generator, date formatters, CSV export. Should be split.
- `src/pages/ReportsPage.jsx` (747 lines) — all 10 reports in one file. Should be split into individual report components.
- `applyFilters()` is copy-pasted across `MyTasksPage.jsx`, `TeamViewPage.jsx`, and `AdminOverviewPage.jsx`. Should be extracted.
- No test files exist. Zero tests.

---

## Execution Phases

### Phase 0 — Testing Infrastructure + File Cleanup
**Goal:** Set up TDD foundation and reorganize before adding features.

#### 0A. Install testing dependencies
- `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `jsdom`, `@vitest/coverage-v8`
- Add `vitest.config.js` (or merge into `vite.config.js`)
- Add scripts: `"test": "vitest"`, `"test:run": "vitest run"`, `"test:coverage": "vitest run --coverage"`

#### 0B. Split `src/lib/supabase.js` into focused modules
```
src/lib/
  supabase.js          → Supabase client init only
  auth.js              → signInWithGoogle, signOut
  priority.js          → getPriority, PRIORITY_LABELS, PRIORITY_COLORS
  assignmentType.js    → getAssignmentType, ASSIGNMENT_TYPE_STYLES, ROLE_RANK
  helpers.js           → generateTaskId, formatDate, formatDateShort, daysBetween, exportToCSV
```
- Update all imports across the codebase

#### 0C. Extract shared utilities
- Create `src/lib/filters.js` — extract `applyFilters()` used in 3 pages
- DRY up the duplicated filter logic

#### 0D. Split ReportsPage into individual report components
```
src/pages/reports/
  ReportsPage.jsx       → Shell (sidebar, date picker, report switcher)
  TeamTasksReport.jsx
  WorkloadReport.jsx
  ProductivityReport.jsx
  AssignmentMatrixReport.jsx
  AssignmentTypesReport.jsx
  OverdueReport.jsx
  UpcomingReport.jsx
  CompletedTrendReport.jsx
  CommentActivityReport.jsx
  PriorityTrendReport.jsx
  ExportBtn.jsx
```

#### 0F. Design system overhaul — "HY Glass" theme
- Install `framer-motion`
- Update `tailwind.config.js` with brand palette (navy/orange tokens), glass utilities
- Rewrite `index.css` base layer — glass card, glass input, glass button component classes
- Create `src/components/ui/animations.jsx` — reusable Framer Motion wrappers:
  - `FadeIn` — fade + slide up on mount
  - `StaggerChildren` — staggered child animations
  - `SlidePanel` — right-panel spring animation
  - `AnimatedNumber` — count-up animation for stats
  - `SuccessBurst` — green scale pulse for confirmations
  - `ShakeReject` — red shake for decline/error
  - `PageTransition` — wraps each page route
- Restyle `Layout.jsx` — navy-900 sidebar with orange active indicator (animated `layoutId`)
- Restyle `LoginPage.jsx` — glass card on navy gradient
- Restyle all shared UI (`index.jsx`) — glass cards, orange primary buttons, animated toast
- Restyle `TaskDetailPanel.jsx` — spring slide-in, glass backdrop
- Restyle `TaskTable.jsx` — row hover lift + glow, layout animations on filter
- Add `PageTransition` wrapper to every route in `App.jsx`
- Animated stat count-up in `StatsStrip`

#### 0E. Write tests for existing pure logic
- `src/lib/__tests__/priority.test.js` — test all priority calculation paths (due date thresholds, inactivity thresholds, edge cases)
- `src/lib/__tests__/assignmentType.test.js` — test all assignment type combinations (Admin→Staff, Peer, CrossTeam, Upward, Self)
- `src/lib/__tests__/helpers.test.js` — test generateTaskId format, date formatters, daysBetween
- `src/lib/__tests__/filters.test.js` — test applyFilters with various filter combos

---

### Phase 1 — Task Audit Log (foundation for other features)

#### 1A. Database migration (`supabase/migrations/002_audit_log.sql`)
- Create `task_audit_log` table (id, task_id, event_type, performed_by, old_value, new_value, note, created_at)
- RLS: read-only for authenticated users, writable only by service role
- Create DB trigger function to auto-log: `task_created`, `status_changed`, `urgency_changed`, `due_date_changed`, `notes_updated`
- Index on task_id, event_type, created_at

#### 1B. Tests first (TDD)
- `src/lib/__tests__/auditLog.test.js` — test audit log data formatting/parsing helpers
- `src/components/__tests__/ActivityLog.test.jsx` — test rendering of audit events

#### 1C. Frontend: Audit log display
- Create `src/components/tasks/ActivityLog.jsx` — collapsible timeline component
- Integrate into `TaskDetailPanel.jsx` below comments
- Create `src/hooks/useAuditLog.js` — fetch audit events for a task

#### 1D. Frontend: Audit Log Report (Admin only)
- Create `src/pages/reports/AuditLogReport.jsx`
- Add to report list in ReportsPage
- Filterable by event type, person, date range

---

### Phase 2 — Task Acceptance / Decline

#### 2A. Database migration (`supabase/migrations/003_acceptance.sql`)
- Add columns to tasks: `acceptance_status` (Accepted/Pending/Declined), `decline_reason`, `accepted_at`, `declined_at`
- Create DB trigger: auto-set `acceptance_status` based on `assignment_type` on INSERT
  - Superior/Self → 'Accepted' + set accepted_at
  - Peer/CrossTeam/Upward → 'Pending'
- Update RLS if needed for decline actions
- Add audit log triggers for `accepted` and `declined` events

#### 2B. Tests first (TDD)
- `src/lib/__tests__/acceptance.test.js` — test which assignment types require acceptance
- `src/components/__tests__/AcceptanceBanner.test.jsx` — test pending task banner
- `src/hooks/__tests__/useTaskActions.test.js` — test accept/decline action flows

#### 2C. Frontend: Accept/Decline UI
- Create `src/components/tasks/AcceptanceBanner.jsx` — yellow banner for pending tasks count
- Add Accept/Decline buttons to `TaskTable.jsx` rows (for Pending tasks only)
- Add Accept/Decline UI to `TaskDetailPanel.jsx` metadata section
- Create decline modal component
- Update `useTasks.js` to handle acceptance_status in queries/filters
- Add "Declined" filter option to FilterRow

#### 2D. Frontend: Reassignment flow
- Add "Reassign" button on declined tasks (visible to original assigner + admins)
- Reassign updates `assigned_to`, resets `acceptance_status` to Pending, logs `reassigned` event
- Update `useTaskActions` with `reassignTask()` method

#### 2E. Reports updates
- Add "Tasks Declined" and "Decline Rate %" columns to Productivity report
- Add "Declined Tasks Log" section/mini-report

---

### Phase 3 — Assigned By Override (Admin Only)

#### 3A. Tests first (TDD)
- `src/components/__tests__/AssignerOverride.test.jsx` — test dropdown only renders for admins
- Test that assignment type recalculates based on overridden assigner

#### 3B. Frontend: Override UI
- Modify `AssignTaskPage.jsx` — add "Assigned By (override)" dropdown for Admin users only
- Conditionally render (not just CSS hide) — `{isAdmin && <OverrideDropdown />}`
- Recalculate assignment type preview when override changes
- Pass overridden assigner to `assignTask()`

#### 3C. Audit trail integration
- Log `assigner_override` event with performed_by (actual admin) and override_value (stated assigner)
- Display override note in TaskDetailPanel under "Assigned By" field

---

### Phase 4 — Feedback Items (from Claude's review)

#### 4A. Per-report loading states
- Add loading spinner to individual report components when switching reports or changing date range

#### 4B. Assignment matrix scalability
- Add "Top N" filter and team filter to AssignmentMatrixReport

#### 4C. React error boundaries
- Create `src/components/ErrorBoundary.jsx`
- Wrap main views in App.jsx

#### 4D. "Who It's For" searchable/filterable
- Add `who_due_to` to search filter logic in applyFilters

#### 4E. Email alert provider
- Wire Resend into `send-alerts/index.ts` (currently placeholder)

---

### Phase 5 — Future Considerations (not in current scope)
- Server-side pagination for useTasks (needed at ~500-1000 tasks)
- In-app notification system
- Bulk task actions
- Task dependencies
- Post-creation urgency escalation

---

## File Structure After Cleanup

```
src/
  lib/
    supabase.js              Supabase client init
    auth.js                  Google OAuth sign in/out
    priority.js              Priority engine (getPriority, colors, labels)
    assignmentType.js        Assignment type logic + styles
    helpers.js               generateTaskId, date formatters, CSV export
    filters.js               Shared applyFilters function
    __tests__/
      priority.test.js
      assignmentType.test.js
      helpers.test.js
      filters.test.js
  hooks/
    useAuth.jsx              Auth context + hook
    useTasks.js              Task data, actions, profiles hooks
    useAuditLog.js           (Phase 1) Audit log fetch hook
    __tests__/
  components/
    layout/
      Layout.jsx             Sidebar + main wrapper
    tasks/
      TaskTable.jsx          Task list table
      TaskDetailPanel.jsx    Slide-in detail panel
      ActivityLog.jsx        (Phase 1) Audit log timeline
      AcceptanceBanner.jsx   (Phase 2) Pending tasks banner
    ui/
      index.jsx              Shared UI components (glass-styled)
      animations.jsx         Framer Motion wrappers (FadeIn, SlidePanel, etc.)
    ErrorBoundary.jsx        (Phase 4)
    __tests__/
  pages/
    LoginPage.jsx
    MyTasksPage.jsx
    AssignTaskPage.jsx
    TeamViewPage.jsx
    AdminOverviewPage.jsx
    SettingsPage.jsx
    reports/
      ReportsPage.jsx        Report shell + switcher
      TeamTasksReport.jsx
      WorkloadReport.jsx
      ProductivityReport.jsx
      AssignmentMatrixReport.jsx
      AssignmentTypesReport.jsx
      OverdueReport.jsx
      UpcomingReport.jsx
      CompletedTrendReport.jsx
      CommentActivityReport.jsx
      PriorityTrendReport.jsx
      AuditLogReport.jsx     (Phase 1)
      ExportBtn.jsx
  App.jsx                    Router + auth wrapper
  main.jsx                   Entry point
  index.css                  Tailwind + custom styles

supabase/
  migrations/
    001_initial.sql          Original schema
    002_audit_log.sql        (Phase 1) Audit log table + triggers
    003_acceptance.sql       (Phase 2) Acceptance/decline columns + triggers
  functions/
    send-alerts/index.ts     Email alert cron function
```
