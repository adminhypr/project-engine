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
- **Notification email is offline-only.** Per-event email functions skip users with a recent `profile_presence.last_seen_at` heartbeat. The `notification-digest` cron is the path that actually sends batched email. Don't add direct `Resend` calls in new triggers — enqueue to `notification_outbox` instead. Use `_shared/email.ts:sendEmail()` (returns `SendResult`); don't roll your own `fetch` to Resend.
- **Hub modules have two layout layers.** `hub_modules.column_index` / `position` is the canonical "house" layout (admin-curated). `hub_module_user_layout` rows override it per user. Drag-reorder by a regular member writes overrides; admins editing the canonical layout write `hub_modules`. Don't conflate them.
- **Heartbeat goes to `profile_presence`, not `profiles`.** Migration 084 split presence onto its own table to avoid re-firing `sync_effective_role` and the 042 self-update guard ~16 writes/sec at scale. `useAuth.jsx` calls `supabase.rpc('heartbeat')`. Anyone reading "is X online" must query `profile_presence.last_seen_at` (use `_shared/presence.ts:isProfileOnline()` from edge functions). `profiles.last_seen_at` still exists as a stale rollback column — do NOT use it for new code.
- **`hub-files` storage is hub-member scoped.** Migration 073 enforces RLS via `hub_id_from_storage_name(name)` which extracts the leading folder uuid. EVERY upload to `hub-files` MUST start with `{hubId}/...` or it'll be invisible/un-uploadable. Compliant call sites: `useHubFiles`, `RichInput`, `TodoEditor`, `FileAttachments` (which prepends `{hubId}/card-attachments/...`). New upload sites must follow the same convention.
- **Mandatory webhook secret.** `verifyWebhookSecret` is strict since 081 — every cron-driven and webhook-driven edge function rejects requests without a valid `X-Webhook-Secret` header. The secret comes from `WEBHOOK_SHARED_SECRET` env var on functions and `app.webhook_secret` GUC on the database. New edge functions invoked by pg_cron or Database Webhooks must include the same check. New cron jobs must include the header (matching pattern in 081).
- **Image upload guards live in `src/lib/uploadGuards.js`.** `isBlockedImageType(file)` rejects SVG (XSS via `<script>`). Used by `RichInput`, `TodoEditor`, `useAvatarUpload`. New image-upload paths should import this rather than re-rolling the check.
- **Tasks visibility predicate is `can_user_see_task(user, task)`.** SECURITY DEFINER STABLE function from 076. The tasks SELECT RLS uses the `is_task_visible(task)` wrapper (083). Anywhere else that needs "can this user see this task" — task-chat enrolment, future RPCs — should call `can_user_see_task` rather than re-implementing the predicate.

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

**Audit fixes — security (073–077):**
- **073_hub_files_storage_rls.sql** — Replaces 016's permissive `auth.role()='authenticated'` storage policies on `hub-files` with hub-member checks via the leading folder uuid (`hub_id_from_storage_name(text)` STABLE helper). Closes audit C1: externals could fetch any inline image / card attachment by guessing the path. Object-naming convention required: every upload MUST be `{hubId}/...`. `useHubFiles`, `RichInput`, `TodoEditor`, and `FileAttachments` all comply (FileAttachments was patched in `207f24e` to add the `hubId` prefix to card-attachments).
- **074_hub_members_no_self_owner.sql** — Closes audit C2: 016's `hub_members_insert` self-insert escape (`profile_id = auth.uid() AND role='owner'`) let any user claim ownership of any hub. New policy only permits self-insert as owner when the hub has zero members yet (creator path). Existing-hub takeovers via direct INSERT now blocked.
- **075_profile_teams_write_hardening.sql** — Closes audit C3. Adds explicit `profile_teams_update` and `profile_teams_delete` policies (Admin via 007's FOR ALL, Manager/TeamLeader on the team only — and ONLY for non-Admin target rows). Plus a BEFORE UPDATE trigger `guard_profile_teams_self_role_change` blocks any role-change where `profile_id = auth.uid()` (defense-in-depth against future policy regressions). Manager-demoting-Admin gap closed.
- **076_task_chat_mention_visibility_check.sql** — Closes audit H1. Adds `can_user_see_task(p_user uuid, p_task uuid)` SECURITY DEFINER STABLE helper that mirrors the live tasks SELECT predicate from 011 + 039 (assignee / assigner / Admin / Manager-on-team / reports-to of primary assignee, plus external-user outer guard). The 047 trigger's `auto_enrol_mentioned_in_task_chat()` is rewritten to call this helper before enrolling internal mentioned users — closes the privilege-escalation gap where a Staff member could enrol any internal user as a task-chat participant.
- **077_hub_files_mime_allowlist.sql** — Closes audit H3. Sets `allowed_mime_types` on the `hub-files` bucket to a curated list excluding SVG, HTML, and other script-capable types. Includes `application/octet-stream` to allow files with browser-unclassified MIME (trade-off documented in the migration). Defense-in-depth: `src/lib/uploadGuards.js` provides `isBlockedImageType()` used by `RichInput`, `TodoEditor`, and `useAvatarUpload` to reject SVG client-side with a clear toast.

**Audit fixes — reliability (078–081):**
- **078_outbox_claim_column.sql** — Adds `notification_outbox.claimed_at` column + replaces the 062 partial index. Index predicate is `emailed_at is null AND claimed_at is null` (NOT a time-window — partial-index predicates must be IMMUTABLE; `now()` is STABLE). Stale-claim recovery via `reset_stale_outbox_claims()` SECURITY DEFINER helper (clears claims older than 10 min). Foundation for the digest atomic-claim refactor.
- **079_recurrence_atomic_spawn.sql** — `spawn_recurrence(p_recurrence_id, p_task_id_str, p_due_date, p_assignees jsonb, p_creator)` SECURITY DEFINER RPC wraps the task INSERT + task_assignees + audit log writes + `next_run_at` advance into one transaction. Uses `pg_try_advisory_xact_lock(hashtext(p_recurrence_id::text))` for per-template serialization (auto-released at COMMIT/ROLLBACK). Closes audit #8: spawn-recurring-tasks could leave half-applied state on crash, or duplicate-spawn under cron overlap. The edge function calls this RPC; pre-spawn validation (assignees, creator) stays in TS.
- **080_dm_email_log_unique.sql** — Adds `dm_email_log.time_bucket` GENERATED ALWAYS column (15-min UTC bucket via IMMUTABLE `to_timestamp(floor(extract(epoch from sent_at) / 900) * 900)`) + unique index on `(recipient_id, conversation_id, time_bucket)`. Closes audit #9: `dm-offline-notify` debounce was non-atomic (SELECT-then-INSERT race). Refactored to claim-before-send via INSERT with ON CONFLICT 23505 short-circuit.
- **081_cron_jobs_use_webhook_secret.sql** — Strict-mode pivot for edge function auth (audit #10). `_shared/security.ts:verifyWebhookSecret` now returns FALSE when `WEBHOOK_SHARED_SECRET` is unset (was: returns TRUE / soft-fail-open). Re-schedules the three pg_cron jobs (`dm-offline-notify-minute`, `spawn-recurring-tasks-hourly`, `notification-digest-15min`) with `X-Webhook-Secret` header sourced from `current_setting('app.webhook_secret', true)`. **Critical deploy ordering documented in the migration header — must set both secrets before applying or every cron tick 403s.** `send-alerts` is not pg_cron-scheduled (Supabase function scheduler) and must be edited manually in the dashboard. `notify` and `hub-mention-notify` are Database Webhook callers and ALSO need `X-Webhook-Secret` headers added in the dashboard before deploy.

**Audit fixes — scaling (082–084):**
- **082_outbox_retention.sql** — Three SECURITY DEFINER prune helpers + nightly pg_cron jobs (03:15/30/45 UTC). `prune_notification_outbox` (30d), `prune_task_audit_log` (1y), `prune_hub_card_audit_log` (180d). Uses CTE pattern `with deleted as (... returning 1) select count(*)::int` to return the actual delete count. Closes audit H1 unbounded-growth half (the other half — atomic claim + skip-row-marking — is in 078 + the digest refactor).
- **083_tasks_rls_helper.sql** — `is_task_visible(p_task uuid)` SECURITY DEFINER STABLE wraps `can_user_see_task(auth.uid(), p_task)` from 076. Replaces the inline EXISTS-soup tasks SELECT policy ("Task visibility by role") with a single helper-backed policy `tasks_select`. STABLE function-result caching means at scale Postgres pays the predicate cost once per (caller, row) pair instead of re-running 4 EXISTS subqueries per row.
- **084_heartbeat_rpc.sql** — Splits presence cursor onto its own `profile_presence` table (PK profile_id FK profiles, last_seen_at timestamptz). `heartbeat()` SECURITY DEFINER RPC upserts `(auth.uid(), now())` with `WHERE auth.uid() IS NOT NULL` guard (suppresses anon-caller error noise). `useAuth.jsx` heartbeat now calls `supabase.rpc('heartbeat')` instead of `UPDATE profiles` — bypasses `sync_effective_role` and the 042 self-update guard triggers (formerly fired ~16 writes/sec at 1000 active users). `_shared/presence.ts` and `notification-digest` now read from `profile_presence`. `profiles.last_seen_at` retained for rollback safety; drop in a follow-up migration after soak.

**Deep-link notifications (085–086):**
- **085_deep_link_payloads.sql** — Enriches notification trigger payloads with source row ids (`comment_id`, `message_id`) so digest emails can render LINKS that scroll to the specific message/comment, not just text. Replaces `enqueue_comment_notification`, `enqueue_dm_message_notification`, `enqueue_hub_mention_notification`. No schema change.
- **086_fix_hub_mention_entity_type.sql** — Bugfix on 085. Matched on `entity_type='hub_message'` but `useHubMessages.postMessage` writes `'message'` / `'message_reply'`, so `message_id` was always null. Replies leave `message_id` null in v1 (only top-level posts have anchors).

**Audit follow-ups (087–088):**
- **087_tasks_urgency_allow_urgent.sql** — Pre-existing bug surfaced by 079. `template_urgency` in 058 allows 'Urgent' but `tasks.urgency` CHECK in 001 only allowed Low/Med/High. Recurring spawns of Urgent templates failed inside the spawn_recurrence transaction with `tasks_urgency_check` violation. CHECK extended to include 'Urgent'.
- **088_spawn_recurrence_null_creator_guard.sql** — Pre-existing bug surfaced by 079. `task_recurrences.created_by` has ON DELETE SET NULL; spawning after creator deletion failed `tasks.assigned_by` NOT NULL. Two-layer fix: edge function pre-checks `rec.created_by IS NULL` and deactivates + audits the template (mirrors empty-assignees path); RPC has defensive early-return on `p_creator IS NULL`. Extends `task_recurrence_audit.event_type` CHECK with `'spawn_failed_creator_deleted'`.

**Ops visibility + to-do notifications (089–090):**
- **089_notify_failures.sql** — `notify_failures` table for ops visibility into permanent email send failures (audit Task 3.5). Replaces console-only logging; gives surface area for dashboards and alerting on dead-letter rate. Edge functions write here on permanent Resend failures.
- **090_todo_assignment_notifications.sql** — Bug: assigning a hub member to a to-do item produced no bell/email. Adds trigger on `hub_todo_item_assignees` that enqueues `todo_assigned` events to `notification_outbox`, mirroring task-assignment flow.

**Hub creation + RLS recursion + ownership (091–094):**
- **091_create_hub_with_owner_rpc.sql** — Real prod bug: user created a hub, refresh made it disappear. Root cause: hub INSERT + initial `hub_members` (owner) row weren't atomic; RLS race could orphan the hub. New `create_hub_with_owner(...)` RPC wraps both writes; backfill repairs orphans.
- **092_fix_card_assignee_audit_during_cascade.sql** — Real prod bug: deleting a hub failed with audit-log FK violation. Cascade chain `hubs → hub_modules → hub_card_columns → hub_cards → hub_card_assignees` fires `audit_hub_card_assignee_change()` AFTER parent card is already gone. Fix: skip audit INSERT when parent card no longer exists (only audit user-initiated unassignments).
- **093_fix_hub_members_insert_recursion.sql** — Real prod bug: "Add member" failed with `42P17 infinite recursion detected in policy for relation "hub_members"`. Migration 074's tightened insert policy re-introduced a self-referential subquery. Replaces with a SECURITY DEFINER helper function.
- **094_hub_ownership_transfer_and_last_owner_guard.sql** — Adds `transfer_hub_ownership(hub_id, new_owner)` RPC and a guard preventing the last owner from leaving / being demoted. Closes the "ghost hub" failure mode.

**Cron auth saga (095–096):**
- **095_cron_webhook_secret_via_vault.sql** — Migration 081 wrote cron jobs to read the secret from `current_setting('app.webhook_secret', true)` (a postgres GUC). In practice the GUC wasn't reliably set on the cron worker, so jobs sent empty `X-Webhook-Secret`. Switches to Supabase Vault as the source of truth, with the GUC as fallback.
- **096_cron_add_authorization_header.sql** — Discovered after deploying strict-mode functions: `net._http_response` showed 383 × 401s. Supabase's edge gateway rejects calls without an `Authorization: Bearer <anon>` header BEFORE the function even runs, regardless of `verifyWebhookSecret`. Adds the Authorization header to every cron-scheduled call alongside the webhook secret.

**Tasks RLS reverts + recurrence parity + audit sweep (097–099):**
- **097_tasks_select_inline_predicate.sql** — Real prod bug: every task creation failed with `42501: new row violates row-level security policy for table "tasks"`. Root cause: 083's helper-backed `tasks_select` policy used a STABLE function; the snapshot taken inside `INSERT ... RETURNING` didn't yet contain the just-inserted row, so the SELECT-after-INSERT predicate failed. Reverts SELECT policy to the inline EXISTS-based predicate. Logged as migration_pitfalls #9.
- **098_task_recurrences_insert_match_tasks_parity.sql** — Real prod bug: Manager creating a recurring task for a cross-team assignee failed RLS. The `task_recurrences_insert` policy was tighter than `tasks_insert` (didn't accept "Manager assigning a user who reports to them" or admin path). Loosened to mirror tasks_insert exactly. Logged as migration_pitfalls #10.
- **099_rls_audit_fixes_hub_members_mentions_recurrence_assignees.sql** — Comprehensive RLS audit after 097/098 surfaced 3 latent regressions of the same shapes: (a) hub_members self-row escape, (b) hub_mentions inserter-excluded SELECT, (c) recurrence/task_assignees parity gaps. None had been reported in prod yet but all reproduced in tests.

**Cross-table RLS audit fixes (100):**
- **100_rls_audit_parent_visibility_fixes.sql** — Cross-table audit (post-099) found 7 latent bugs of two shapes: (a) policies gating on `auth.role()='authenticated'` instead of delegating to parent visibility, (b) policies using denormalized `profiles.team_id` instead of `profile_teams` (007 regression that was missed in this table). None reported in prod. Fixes: **C1** `task_audit_log` SELECT — replaces 002's stale single-team Manager check with `can_user_see_task` (also picks up secondary-assignee + reports_to paths the original 002 policy was missing). **C2** `task_assignees` SELECT — was org-wide-readable (any internal user could enumerate every (task_id, profile_id) pair); now delegates to parent task visibility with own-row escape clause for INSERT-RETURNING (mirrors 099's hub_members fix). **C3** `task_assignees` INSERT — was permissive (any internal user could attach themselves to any task → privilege escalation via the assignee branch of `tasks_select`); tightened to assigner / primary assignee / Admin / Manager-on-team (matches task DELETE permissions from 010). **C4** `comments` INSERT (task branch) — was permissive (any internal user could post comment on any task; legitimate watchers received the spam via notification triggers); now requires `can_user_see_task`. **H2** `task_attachments` INSERT (DB row) — was permissive; now requires `can_user_see_task` (storage bucket policies from 049 already gated by uid-prefix). **H4** `task_dependencies` SELECT/INSERT/DELETE — gated on "tasks exist" instead of "user can see tasks"; replaced both endpoints with `can_user_see_task`. **H5** `task_recurrence_assignees` SELECT and `task_recurrence_audit` SELECT — gated on "parent recurrence exists" instead of caller-can-see-parent; inlined the same Admin/creator/Manager-or-TeamLeader-on-team predicate as `task_recurrences_select`. Out of scope (need product/design call): C5 (`tasks_insert` cross-team), H1 (`conversations` kind='task' visibility), H3 (`hub_todo_item_assignees.assigned_by` user-spoofable).

## Supabase Edge Functions

All are Deno-based and use Resend for email delivery via the shared `_shared/email.ts` helper.

**Shared helpers:**
- **`_shared/security.ts`** — `verifyJWT()`, `verifyWebhookSecret()`, `corsHeadersFor()`. `verifyWebhookSecret` is STRICT since 081 (returns false if `WEBHOOK_SHARED_SECRET` env unset). Every cron-driven and webhook-driven function gates on this; preflight OPTIONS goes through CORS first.
- **`_shared/email.ts`** — `sendEmail(to, subject, html, opts?)` returns a `SendResult` discriminated union (`{ok: true, id}` | `{ok: false, retryable, status, error}`). Internally retries 3× on 429/5xx/network with quadratic backoff (250 × attempt²). 4xx (not 429) returns immediately as permanent. Resolves `FROM_EMAIL` → `ALERT_FROM_EMAIL` → `DM_FROM_EMAIL` for backward compat. All callers should branch on `retryable` to decide between release-claim-for-retry vs dead-letter behavior.
- **`_shared/presence.ts`** — `isProfileOnline(id)` and `getOnlineProfileIds(ids)`. Both read from `profile_presence.last_seen_at` (post-084) — NOT `profiles.last_seen_at`.

**Functions:**
- **`supabase/functions/notify/`** — Triggered by Supabase Database Webhook on tasks INSERT/UPDATE. Sends transactional emails for: task assigned (skips self-assignments), task declined (with reason), task completed, task reassigned. Uses the shared helper; logs permanent send failures via wrapper. **Webhook config in dashboard must include `X-Webhook-Secret` header (post-081).**
- **`supabase/functions/send-alerts/`** — Scheduled (Supabase function scheduler, NOT pg_cron — every 2h). Red alerts (overdue/inactive) to assignee + manager CC, due reminders at 4h/24h milestones. `email_alert_sent` flag prevents duplicate red alerts. **Schedule must include `X-Webhook-Secret` header — set manually in dashboard.**
- **`supabase/functions/user-notify/`** — Called from the frontend via `supabase.functions.invoke()`. User lifecycle emails: approval notifications, invites. NOT migrated to `_shared/email.ts` (out of audit scope).
- **`supabase/functions/hub-mention-notify/`** — Triggered by Database Webhook on `hub_mentions` INSERT. Returns 200 on success or permanent failure (deliberately giving up); 500 on transient/retryable failure so the webhook subsystem retries. **Webhook config in dashboard must include `X-Webhook-Secret` header (post-081).**
- **`supabase/functions/admin-delete-user/`** — Admin-only. Verifies caller via JWT + admin role check. Deletes from `auth.users` (cascades to profiles, tasks, comments).
- **`supabase/functions/dm-offline-notify/`** — pg_cron `dm-offline-notify-minute` (every 1 min). Flushes `pending_dm_emails` older than 3 min. **Atomic debounce (post-080):** INSERT into `dm_email_log` first; on 23505 unique violation skip Resend (another worker owns this 15-min bucket); on Resend transient-fail DELETE the claim row so next tick retries; on permanent-fail mark queue rows `resend_failed` and KEEP claim (don't burn the next 15 min retrying a doomed address).
- **`supabase/functions/notification-digest/`** — pg_cron `notification-digest-15min`. **Atomic claim + concurrent send (post-078 + Task 2.2):** (1) call `reset_stale_outbox_claims()` to clear claims from crashed prior runs, (2) `UPDATE notification_outbox SET claimed_at=now() WHERE id IN (...) AND claimed_at IS NULL AND emailed_at IS NULL RETURNING ...` to atomically claim, (3) batch-mark skip rows (online / opted-out / no-email) as `emailed_at`, (4) parallel send with concurrency cap of 8. On Resend permanent-fail mark `emailed_at` (dead-letter, log error); on transient-fail release the claim. Reads presence from `profile_presence` (post-084).
- **`supabase/functions/spawn-recurring-tasks/`** — pg_cron `spawn-recurring-tasks-hourly`. Sole writer of spawned tasks. **Atomic spawn (post-079):** edge function does pre-spawn validation (creator exists, valid assignees) then calls `spawn_recurrence(...)` RPC which holds `pg_try_advisory_xact_lock` for the duration of one transaction. NULL-creator pre-checked since 088 (deactivates + audits). Frontend must never insert spawned tasks directly — would race the cron.

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

Vitest + React Testing Library with jsdom. Tests live in `src/lib/__tests__/` and cover pure logic modules — priority, assignment type, acceptance, multi-assignee, per-assignee completion, sub-tasks, dependencies, recurrence, filters, helpers, mentions, external roles, per-team roles, team membership, todo colors, DM ordering / unread / contacts / prefill / widget storage, group conversations, group seen-by, chat-section unread, conversation ordering, content format, emoticons, tiptap extract, cards, notification links, chunk reload, active team. Run a single file with `npm test -- src/lib/__tests__/<name>.test.js`. There are no component / integration tests — UI behavior is verified manually.
