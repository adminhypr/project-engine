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

**Stack:** React 18 + Vite 5, Tailwind CSS 3, Framer Motion, Supabase (Postgres + Auth + Realtime + Storage), Recharts, TipTap (rich text for @mentions), `@dnd-kit` (drag-and-drop for todos and module order), `papaparse` (CSV export), deployed on Vercel.

**Path alias:** `@` maps to `/src` (configured in vite.config.js).

**Key architectural patterns:**

- **Auth flow:** `useAuth` hook (React Context) wraps the app. Provides `session`, `profile`, `isAdmin`, `isManager`, `isStaff`. Uses a custom REST fetch (`fetchProfileDirect`) to bypass the Supabase JS client's auth queue, with token expiration checks and auto-refresh retry logic.
- **Data layer:** `useTasks` hook handles fetching, real-time subscriptions, and task enrichment (priority calculation). `useTaskActions` provides `assignTask`, `updateTask`, `addComment`, `getTaskComments`, `acceptTask`, `declineTask`, `reassignTask`. `useProfiles` fetches all users and teams. `useAttachments` handles task file uploads to the `task-attachments` Storage bucket (5 MB max per file). `useAuditLog` provides task-specific event history and admin/manager report queries with date/team filtering.
- **Project Hubs data layer:** One hook per hub module — `useHubs` (list/create/join), `useHubMembers`, `useHubChat` (Campfire realtime, now backed by `conversations` kind=`hub` per migration 064), `useHubMessages` (threaded message board), `useHubTodos` (named to-do lists with checkable items, multi-assignee, drag reorder) + `useHubTodoComments` (per-item discussion) + `useHubTodoAttachments` + `useHubTodoSubscribers` + `useMyHubTodos` (cross-hub aggregate for `/todos`), `useHubFiles` (docs & files with folder hierarchy), `useHubActivity` (aggregated feed), `usePresence` (who's online). Check-ins, Calendar, and the legacy `hub_chat_messages` table were removed in migrations 064–065 — do not reintroduce.
- **Hub modules registry (migration 066):** Modules are first-class rows in `hub_modules`, not hardcoded singletons. A hub can have multiple instances of `message-board`, `attendance-room`, `campfire`, `docs-files`, `to-dos`, and `card-table` (added in 069), each with title and 3-column grid position. `useHubModules` manages the canonical "house" layout (owner/admin only). `useHubModuleOrder` was superseded by `hub_module_user_layout` (migration 068): per-user drag overrides layered on top of the canonical layout, with a "Reset layout" button that deletes the caller's overrides. Drag-reorder writes user overrides only; admins curate the canonical layout via `hub_modules` directly.
- **Card Table module (migrations 069–072):** Basecamp-style kanban — a NEW entity, not a task extension. `hub_card_columns` → `hub_cards` → `hub_card_steps` (per-card subtask checklist). Reuses the existing `comments` table polymorphically (`comments.card_id` nullable, with a CHECK that exactly one of `task_id`/`card_id` is set) and the notification outbox (event types extended with `card_*`). Cards do NOT participate in My Tasks, escalation, or the task email pipeline. Hooks: `useHubCardColumns`, `useHubCards`, `useHubCardSteps`. Card comments + notes support inline images and generic file attachments via `card-attachments` Storage bucket (migration 072).
- **Direct messaging (chat widget) data layer:** `useConversations` lists 1:1 + group conversations with unread counts + realtime upserts via a module-level `EventTarget`. `useConversation(id)` streams messages for one thread (pattern mirrors `useHubChat`). `useDmRealtime` is one global `dm_messages` subscription mounted in `AuthProvider`; RLS limits delivery. `useGlobalPresence` is one app-wide Supabase presence channel, also mounted in `AuthProvider` — returns a `Map<userId, {online, onlineAt}>` exposed via `useAuth().presence`. `useContactList` composes `useProfiles` + `useConversations` + presence into `{ recent, teammates, company }` sections. `useDmTyping` broadcasts typing indicators via Supabase channel (not persisted). `useGroupReadState` + `useOtherReadState` drive per-participant read receipts. `useMessageReactions` manages the emoji reaction pill row. `useThread(rootId)` + `useThreadCounts(rootIds)` power Slack-style thread side panels (migration 037) — distinct from quote-replies (`reply_to_id`, migration 032) which can coexist in the same message.
- **Priority engine:** `getPriority()` in `src/lib/priority.js` computes red/orange/yellow/green from due dates or last-updated timestamps. Always computed at read time, never persisted. Thresholds: red = overdue or 36h+ inactive, orange = due in 4-12h, yellow = due in 12-24h, green = on track.
- **Multi-team membership:** Users can belong to multiple teams via `profile_teams` junction table. One team is marked `is_primary`. `profiles.team_id` is kept in sync as a denormalized primary. Profiles are enriched with `team_ids` (array) and `all_teams` (with names). Settings page uses chip UI for team management. Assign page shows team picker when assignee has 2+ teams.
- **Per-team roles:** Users can have different roles (Staff/Manager/TeamLeader) per team via `profile_teams.role`. Admin remains a global role on `profiles.role`. The profile's effective role is auto-synced as the max across all team roles (but never downgrades Admin — and never overwrites external `Agent`/`Client` globals, which are sticky). `profile.team_roles` is a `{team_id: role}` map enriched at fetch time. Assignment type uses the assigner's role in the target team context.
- **External roles (Agentboard — migrations 038–041):** Global roles `Agent` and `Client` exist alongside `Admin`/`Manager`/`Staff`. Externals see only hubs they've been invited into; they cannot create hubs (blocked in UI, hook, and RLS). Use the `is_external_user()` DB helper and frontend equivalents when gating features. Do not assume a profile's `role` is always in the core three.
- **Assignment type:** `getAssignmentType()` in `src/lib/assignmentType.js` compares role ranks (Admin=3, Manager=2, Staff=1) and team membership (shares any team = same team). Stored on the task record at creation; reassignments don't change the original type.
- **Multi-assignee tasks:** Tasks can have multiple assignees via the `task_assignees` junction table. `tasks.assigned_to` is kept as the "primary" assignee for backward compatibility with older queries, RLS, and email flows. New code should read from `task_assignees` when a complete list is needed.
- **Acceptance flow:** Superior and Self assignments auto-accept via DB trigger (before insert). Peer/CrossTeam/Upward default to Pending. Reassignment resets acceptance to Pending. Migration 036: if a Pending assignee changes status to In Progress or Done, the task implicitly auto-accepts in the same update and an "Auto-accepted" entry is written to `task_audit_log`.
- **Sub-tasks (migration 053):** `tasks.parent_task_id` self-FK. Sub-tasks are full task rows (inherit chat, completion, RLS, audit). Single-level only — a parent must itself have `parent_task_id IS NULL`. Parent auto-closes only when every child is Done; force-closing a parent leaves children open. `useSubtasks` hook drives the UI.
- **Task dependencies (migration 056):** Soft "Blocked by" / "Blocks" linkage via `task_dependencies`. Display-only — the DB never blocks a status transition. The UI shows a warning toast when a user moves a task with open blockers but never prevents the move. `useTaskDependencies` hook.
- **Recurring tasks (migrations 058–060):** `task_recurrences` are templates spawned by the hourly `spawn-recurring-tasks` edge function (the authoritative writer; UI must never insert spawned tasks directly). Simple interval model: `(unit ∈ day/week/month) × every N`, with `anchor_at` = first occurrence and `next_run_at` = upcoming spawn. Never backfills; `is_active=false` freezes spawning entirely; resuming recomputes `next_run_at` to the next future occurrence. If all assignees become invalid by spawn time the template is deactivated and the creator is notified. `useRecurrences` hook.
- **Notification outbox + presence-aware digest (migrations 062–063):** Bell stays real-time and covers every event (task assigned, comment posted, message sent, mentions). Email is for OFFLINE users only and batched into a 15-minute digest via `notification-digest` edge function (cron). `profiles.last_seen_at` is a frontend heartbeat; `profiles.email_digest_enabled` is a per-user opt-out. Triggers on `task_assignees`, `comments`, `dm_messages`, and `hub_mentions` write to `notification_outbox` and skip self-notifications. `comments.mentioned_ids` array adds @mention support to task comments (migration 062).
- **Task chat (migrations 046–048, 052):** Every task has a `conversations` row of `kind='task'` auto-created on task insert. Assigner + assignees seeded as participants by trigger. `ensure_task_chat_participant(tid)` (SECURITY INVOKER) lets a task viewer self-enrol on first open by delegating to task SELECT RLS. @mentioning a user in a task chat auto-enrols them as a participant (migration 047) unless they're an external. Externals can post in task chats they're already in (migration 048). `useTaskChat` hook.
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
- **Chat widget is globally mounted.** `ChatWidget` is rendered once in `App.jsx` inside `AuthProvider` as a sibling to `Layout`, so it persists across page navigation. State is per-profile in `localStorage` under `pe-chat-state-{profileId}`. The widget depends on `useAuth().presence` being populated — do not move `useGlobalPresence` out of `AuthProvider`.
- **Externals are sticky.** `profiles.role` for Agent/Client never gets overwritten by the `sync_effective_role` trigger, even if you add/remove `profile_teams` rows. Changing an external's global role requires an explicit Admin update.
- **Self-updates to sensitive profile columns are blocked.** Migration 042 installs a BEFORE UPDATE trigger that rejects any update where `auth.uid() = profiles.id` AND (`role`, `team_id`, `reports_to`, `email`) changes. Admin/Manager updates on *other* users still work. If a legitimate self-update (e.g., avatar, full_name) starts failing, verify it doesn't touch the guarded columns.
- **Group conversations have a caller-is-member guard.** `get_or_create_team_group(tid)` requires the caller to be in that team (or Admin). Migration 043 special-cases trigger/service-role contexts so auto-enrolment still works.
- **Cards are not tasks.** Card Table cards (migration 069) live in their own tables and reuse `comments` polymorphically via `comments.card_id`. They do not surface in My Tasks, do not trigger the task email pipeline, and do not participate in escalation. When adding features that touch tasks, do NOT auto-extend them to cards unless the requirement is explicit.
- **Recurring tasks have one writer.** Only the `spawn-recurring-tasks` edge function inserts spawned task rows. Adding a frontend "spawn now" path would race the cron; if you need it, route through an RPC the function also calls.
- **Notification email is offline-only.** Per-event email functions skip users with a recent `last_seen_at` heartbeat. The `notification-digest` cron is the path that actually sends batched email. Don't add direct `Resend` calls in new triggers — enqueue to `notification_outbox` instead.
- **Hub modules have two layout layers.** `hub_modules.column_index` / `position` is the canonical "house" layout (admin-curated). `hub_module_user_layout` rows override it per user. Drag-reorder by a regular member writes overrides; admins editing the canonical layout write `hub_modules`. Don't conflate them.

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
- **014_project_hub.sql** — Hub module board, check-ins, events, chat, activity feed.
- **015_hub_events_realtime.sql** — Enables realtime on hub event tables.
- **016_custom_hubs.sql** — Independent hubs with explicit membership, file/folder storage. Migrates existing `hub_*` tables from `team_id`-scoped to `hub_id`-scoped.
- **017_fix_hub_members_recursion.sql** / **018_fix_hub_creator_select.sql** — Break recursion in hub member visibility policies.
- **019_hub_module_order.sql** — `hub_members.module_order` JSONB for per-user drag-sorted module layout.
- **020_hub_team_id_nullable.sql** — Makes `team_id` nullable on hub tables (`hub_id` is the real FK) and adds missing hub-scoped INSERT/UPDATE/DELETE policies.

**Attachments, to-dos, mentions, avatars, DMs (021–029):**
- **021_attachments.sql** — `task_attachments` table + `task-attachments` Storage bucket (5 MB per file).
- **022_hub_todos.sql** / **023_hub_todos_v2.sql** — `hub_todo_lists`, `hub_todo_items`, `hub_todo_item_assignees`, `hub_todo_comments`. Named to-do lists with drag-sortable checkable items, multi-assignee, due dates, comments, and @mentions integration.
- **024_fix_todo_soft_delete_rls.sql** — RLS fix for soft-deleted todo items.
- **025_hub_mentions.sql** — `hub_mentions` table that drives both email (`hub-mention-notify`) and in-app notifications.
- **026_avatar_upload.sql** — Avatar Storage bucket + `profiles.avatar_url`.
- **027_direct_messages.sql** — `conversations`, `conversation_participants`, `dm_messages` tables. `get_or_create_dm` + `mark_conversation_read` RPCs. Soft-delete via `deleted_at`. Realtime enabled. `dm-attachments` Storage bucket.
- **028_dm_email_queue.sql** — `pending_dm_emails` queue + `dm_email_log` debounce log + `enqueue_dm_email` trigger. Drives `dm-offline-notify` edge function.
- **029_schedule_dm_offline_notify.sql** — pg_cron schedule for the DM offline notify edge function.

**DM evolution, groups, threads, reactions, Agentboard, access hardening (030–043):**
- **030_avatar_bucket_10mb.sql** — Raises avatar bucket limit to 10 MB.
- **031_dm_read_state_realtime.sql** — Enables realtime on `conversation_participants.last_read_at` so read receipts update live.
- **032_dm_replies.sql** — Quote-reply: `reply_to_id` + denormalized `reply_to_author_id` / `reply_to_preview` on `dm_messages` so replies render instantly even if original is scrolled out or soft-deleted.
- **033_group_conversations.sql** — `conversations.team_id` + auto-enrolment of team members into the team's default group (`get_or_create_team_group`, `create_custom_group`, `add_group_member`, `leave_group` RPCs). `kind='group'` already existed from 027.
- **034_dm_message_reactions.sql** — `dm_message_reactions` emoji reactions table.
- **035_group_email_mentions_only.sql** — DM offline email: in group conversations, only @mentioned recipients get email; 1:1 DMs unchanged.
- **036_auto_accept_on_progress.sql** — Pending assignee moving a task to In Progress / Done implicitly accepts it; logged as "Auto-accepted" in audit log via the existing `audit_acceptance_change` trigger.
- **037_dm_threads.sql** — Slack-style threads: `dm_messages.thread_root_id` + `dm_thread_counts(root_ids)` helper. One level of nesting only; replies live only in the thread panel, root stays in main stream. Independent of 032's quote-reply (both can coexist).
- **038_agentboard_roles.sql** — Adds global roles `Agent` and `Client`, per-team role `TeamLeader`. Externals (Agent/Client) are **sticky**: the role-sync trigger never overwrites their global role based on per-team rows.
- **039_agentboard_rls.sql** / **040_agentboard_rpc_guards.sql** — RLS + RPC guards that scope Agent/Client visibility to only the hubs they've been invited into.
- **041_block_external_hub_create.sql** — RLS prevents Agent/Client from inserting into `hubs`. UI hides "New Hub"; hook short-circuits; DB is the enforced layer.
- **042_access_hardening.sql** — Security audit follow-up. Blocks self-privilege escalation (BEFORE UPDATE trigger on `profiles` — no user can change their own `role`/`team_id`/`reports_to`/`email`). Drops a stray anon-readable `"Profiles select open"` policy. Scopes `profile_teams` / `teams` reads to self + member teams. Adds caller-is-member check to `get_or_create_team_group`. Adds missing `WITH CHECK` on `conversations` UPDATE.
- **043_fix_team_group_service_context.sql** — Allows trigger / service-role paths through `get_or_create_team_group` (the caller-is-member check from 042 broke auto-enrolment triggers).

**Per-assignee completion (044–045):**
- **044_per_assignee_completion.sql** — Adds `completed_at` / `completed_by` on `task_assignees`. Aggregate trigger writes an `all_assignees_completed` note-event and flips `tasks.status='Done'` only when every assignee has `completed_at` set. Unmarking after aggregate-close reopens the task to `In Progress`. RPC `force_close_task(tid)` lets assigner / admin / any assignee close a task for everyone and writes a `force_closed` audit entry with the prior status preserved. Column-restriction is enforced by a BEFORE UPDATE trigger (`guard_task_assignee_self_update`) since RLS can't limit UPDATE to specific columns.
- **045_sync_assignees_on_task_done.sql** — AFTER UPDATE trigger on `tasks` that back-fills `task_assignees.completed_at` / `completed_by` for any still-open rows whenever `status` transitions to `Done`. Closes a gap where a manual status-dropdown change to Done left per-assignee checkboxes empty. Reuses the `app.force_close` GUC from 044 to bypass the per-row self-update guard. Idempotent on the aggregate + force-close paths.

**Task chat (046–048, 052):**
- **046_task_chat.sql** — Adds `conversations.task_id` + extends the `kind` CHECK with `'task'`. AFTER INSERT triggers on `tasks` and `task_assignees` create a conversation eagerly and seed the assigner/assignees as participants. SECURITY INVOKER RPC `ensure_task_chat_participant(tid)` lets a task viewer self-enrol on first open by delegating to the task SELECT RLS. Migration 039's external-user conversation policies extended to permit `kind='task'` for externals who are participants. Backfill creates conversations + participants for every existing task.
- **047_task_chat_mention_enrol.sql** — AFTER INSERT trigger on `dm_messages` parses the `mentions` jsonb array (shape `{user_id, display_name}`) and auto-enrols any mentioned user as a participant in a `kind='task'` conversation, unless they're an external (Agent/Client) who isn't already a participant.
- **048_task_chat_bump_trigger_definer.sql** — Promotes the `bump_conversation_last_message` trigger to SECURITY DEFINER so externals can send messages in task chats they're a participant in (the trigger updates `conversations.last_message_*` which externals can't UPDATE directly).
- **052_task_chat_unread_rpc.sql** — `task_chat_unread_counts(task_ids)` RPC for batched unread badge counts on task lists.

**Security + audit hardening (049–051):**
- **049_security_hardening.sql** — Closes two findings: (C2) Manager→Admin privilege escalation via the 008 setup-users policy, (C3) `task-attachments` Storage bucket was readable by any authenticated user.
- **050_audit_and_email_quality.sql** — Bundle of four "task completion + audit + email" quality fixes.
- **051_rls_and_search_path_hardening.sql** — Locks `search_path` on SECURITY DEFINER functions and tightens remaining permissive policies.

**Subtasks, dependencies, recurring tasks (053–061):**
- **053_subtasks.sql** — `tasks.parent_task_id` self-FK (single-level only). Sub-tasks are full task rows; parent auto-closes only when every child is Done; force-close on parent leaves children open.
- **054_conversation_unreads_rpc.sql** — Batched conversation-unread RPC for the chat widget.
- **055_task_comment_counts_rpc.sql** — Batched per-task comment counts.
- **056_task_dependencies.sql** — `task_dependencies` (Blocked by / Blocks). Soft / display-only; status transitions never blocked at DB level. UI shows warning toast.
- **057_fix_user_delete_cascade.sql** — Fixes orphaned-row issues when an admin deletes a user.
- **058_recurring_tasks.sql** — `task_recurrences` schema + RLS + audit + realtime. The hourly `spawn-recurring-tasks` edge function is the authoritative writer.
- **059_schedule_spawn_recurring_tasks.sql** — pg_cron schedule for the spawn function.
- **060_fix_recurrence_audit_delete.sql** / **061_fix_recurrence_rls_recursion.sql** — Recurrence audit + RLS fixes.

**Notifications, hub chat unification, hub modules (062–068):**
- **062_notification_outbox_and_digest.sql** — `notification_outbox` queue, `profiles.last_seen_at` heartbeat, `profiles.email_digest_enabled`, `comments.mentioned_ids` for task-comment @mentions, triggers on `task_assignees` / `comments` / `dm_messages` / `hub_mentions` (skipping self-notifications).
- **063_schedule_notification_digest.sql** — pg_cron 15-min schedule for the `notification-digest` edge function (offline-only batched email).
- **064_hub_chat_unified.sql** — Replaces `hub_chat_messages` with `conversations` of `kind='hub'`, mirroring migration 046's task-chat pattern. `useHubChat` is now backed by the unified DM/conversations stack.
- **065_drop_checkins_and_schedule.sql** — Removes Check-ins and Schedule modules from hubs entirely (tables, triggers, RLS). Do not reintroduce.
- **066_hub_modules.sql** — `hub_modules` registry. Multi-instance modules per hub (`message-board`, `attendance-room`, `campfire`, `docs-files`, `to-dos`); 3-column free-flow grid; managed by hub owners/admins.
- **067_sync_hub_conversation_titles.sql** — Keeps `conversations.title` in sync with module/hub renames.
- **068_hub_module_user_layout.sql** — `hub_module_user_layout` per-user overrides on top of canonical `hub_modules` layout. Drag-reorder writes overrides only; "Reset layout" deletes the caller's overrides for a hub. CASCADE on `module_id` and `user_id`.

**Card Table module (069–072):**
- **069_hub_card_table.sql** — Adds `card-table` to the `hub_modules.kind` CHECK. New entities: `hub_card_columns`, `hub_cards`, `hub_card_steps` (per-card subtask checklist). `comments.card_id` nullable with CHECK that exactly one of `task_id`/`card_id` is set. `notification_outbox.event_type` extended with `card_*` values. Cards do NOT participate in task workflows (no My Tasks, no escalation, no task email pipeline).
- **070_card_table_fixes.sql** — Card Table polish (RLS, ordering, cascade fixes).
- **071_card_comment_counts_rpc.sql** — Batched per-card comment counts (mirrors 055 for tasks).
- **072_card_attachments.sql** — `card-attachments` Storage bucket; lets RichInput's existing inline-image flow apply to card notes and card comments. Mirrors hub message-board attachments.

## Supabase Edge Functions

All are Deno-based and use Resend for email delivery:

- **`supabase/functions/notify/`** — Triggered by database webhooks on task INSERT/UPDATE. Sends transactional emails for: task assigned (skips self-assignments), task declined (with reason), task completed, task reassigned.
- **`supabase/functions/send-alerts/`** — Scheduled cron (every 2h). Sends red alerts (overdue/inactive) to assignee + manager CC, and due reminders at 4h/24h milestones. `email_alert_sent` flag prevents duplicate red alerts.
- **`supabase/functions/user-notify/`** — Called from the frontend via `supabase.functions.invoke()`. Sends user lifecycle emails: approval notifications and invite emails.
- **`supabase/functions/hub-mention-notify/`** — Triggered by database webhook on `hub_mentions` INSERT. Sends email to mentioned users with a message preview and hub link via Resend.
- **`supabase/functions/admin-delete-user/`** — Admin-only. Deletes a user from `auth.users` (cascades to profiles, tasks, comments). Requires service role.
- **`supabase/functions/dm-offline-notify/`** — Scheduled cron (every 1 min). Flushes pending DM email rows older than 3 minutes, skipping those where the recipient has read the conversation since; 15-min per-(recipient, conversation) debounce via `dm_email_log`.
- **`supabase/functions/notification-digest/`** — Scheduled cron (every 15 min, migration 063). Drains `notification_outbox` for OFFLINE users (`profiles.last_seen_at` stale + `email_digest_enabled=true`) and emails a single batched digest per user. Authoritative replacement for per-event blasts; existing per-event functions (`notify`, `hub-mention-notify`) now skip-if-online.
- **`supabase/functions/spawn-recurring-tasks/`** — Scheduled hourly. Sole writer of tasks spawned from `task_recurrences` templates. Computes next future occurrence, never backfills, deactivates a template + notifies the creator if all assignees become invalid. The frontend must never insert spawned tasks directly.

## Environment Variables

Required in `.env.local`:
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon public key

## Role Hierarchy and Views

- **Staff:** My Tasks, Assign a Task, Hubs they belong to
- **Manager:** Above + Team View (all assigned teams), own-teams Reports, limited Settings (set up unassigned users on their teams)
- **Admin:** Everything + Admin Overview, all Reports, Settings (full user/team management, edit/delete users)
- **TeamLeader (per-team only):** Per-team role above Staff, below Manager. Lives on `profile_teams.role` only — no global `TeamLeader` on `profiles.role`.
- **Agent / Client (external):** Global roles set on `profiles.role`. See only hubs they've been explicitly invited to; cannot create hubs (RLS blocks `hubs` insert via `is_external_user`). Sticky — role-sync trigger never overwrites these based on per-team rows.

`isManager` in useAuth returns true for both Manager and Admin roles. Hub access is independent of the task-side role — membership is determined by `hub_members`, and a Staff user can be a hub creator/admin (externals cannot).

## Testing

Vitest + React Testing Library with jsdom. Tests live in `src/lib/__tests__/`:
- `priority.test.js` — Due date thresholds, inactivity, precedence rules
- `assignmentType.test.js` — All role/team combinations
- `helpers.test.js` — Task ID format, date formatting
- `filters.test.js` — All filter types, search, combinations
- `acceptance.test.js` — Acceptance logic, reassignment resets
