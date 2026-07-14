# Dev Projects activity notifications — design

**Date:** 2026-07-14 · **Requested by:** David · **Status:** APPROVED (build immediately)

## Goal

Every member of a Dev Project gets notified — realtime bell + the existing offline
email digest — whenever anything happens on the project board, with a content
preview. No new delivery infrastructure: this rides the `notification_outbox`
pipeline from migration 062.

## Events ("anything related to the project")

| event_type | Fires on | Actor source |
|---|---|---|
| `project_bug_reported` | AFTER INSERT on `bugs` | `new.reporter_id` |
| `project_request_created` | AFTER INSERT on `feature_requests` | `new.requester_id` |
| `project_feature_created` | AFTER INSERT on `tasks` WHEN `project_id IS NOT NULL` | `new.assigned_by` |
| `project_feature_moved` | AFTER UPDATE on `tasks` WHEN `project_id IS NOT NULL` AND (`status` OR `project_column_id` changed) | `auth.uid()` (nullable — see residuals) |
| `project_comment` | AFTER INSERT on `comments` WHEN task is a project feature | `new.author_id` |
| `project_promotion` | AFTER UPDATE on `bugs` / `feature_requests` WHEN `promoted_task_id` goes null→set | `auth.uid()` falling back to task's `assigned_by` |

**Recipients:** every `project_members` row for the project, minus the actor.
Payloads carry `project_id`, `project_name`, `actor_name`, entity title, and a
`snippet` — `left(description/content, 140)` — as the preview.

## Key decisions

1. **Purely additive migration (119).** New standalone trigger functions only —
   we do NOT recreate `enqueue_comment_notification` or any live function
   (avoids the prod-drift gotcha; no Management API read needed at authoring
   time). The comment fan-out is a SECOND trigger on `comments` that notifies
   project members MINUS the people the 062 trigger already covers (author,
   assigner, assignees, mentioned) so nobody gets double rows.
2. **Drift-proof CHECK extension.** `notification_outbox_event_type_check` has
   been reset by 069 and 090 and prod has drifted from files before (102). The
   migration reads the LIVE constraint definition from `pg_constraint`, extracts
   the existing value list by regexp, unions the six new values, and recreates —
   so it cannot clobber values added out-of-band.
3. **Promotion = two DB events, one visible notification.** Promote flows insert
   the task first, then set `promoted_task_id` (separate statements), so both
   `project_feature_created` and `project_promotion` fire. The DB stays truthful;
   the presentation layer (bell lib + digest renderer) collapses pairs sharing
   `task_id`, showing only the richer promotion entry.
4. **Bell reads the outbox directly.** 062 already gives us: outbox in the
   `supabase_realtime` publication + `notif_outbox_select_self` SELECT policy.
   The reserved `delivered_to_bell_at` column becomes the durable, cross-device
   seen flag (this is the "future migration" 062's comment anticipated, scoped
   to project events only). New: recipients may UPDATE their own rows, but a
   BEFORE UPDATE guard trigger rejects non-service changes to any column other
   than `delivered_to_bell_at` (protects `emailed_at`/`claimed_at` from
   tampering that could suppress or duplicate the tamperer's own email).
5. **Digest rides existing rendering.** `renderDigestHtml` groups rows by
   `event_type` into sections; we add one "Dev Projects" section that groups by
   `project_name` with preview lines and links to `/projects/:id`.

## Frontend

- `src/lib/projectActivity.js` (pure, TDD): `formatProjectActivity(row)` →
  `{title, body, link, kind}`; `collapsePromotions(rows)` (decision 3);
  exported `PROJECT_EVENT_TYPES` list shared by hook + tests.
- `src/hooks/useProjectActivityNotifications.js`: initial fetch (unseen =
  `delivered_to_bell_at is null`, event_type in list, recipient me, newest 30)
  + one realtime INSERT subscription filtered `recipient_id=eq.{me}` (event
  type filtered client-side); `markSeen(id)` / `markAllSeen()` stamp
  `delivered_to_bell_at`. Mirrors `useMentionNotifications` structure.
- `NotificationBell.jsx`: new source wired like todoAssignments; icon per kind
  (Bug / Lightbulb / KanbanSquare / MessageSquare / Rocket), body = preview
  snippet, link `/projects/{project_id}`.

## Known residuals (accepted)

- **dev-api / CLI moves have no `auth.uid()`** → `project_feature_moved` from
  the API notifies ALL members (actor can't self-exclude) and renders the actor
  as "A teammate". Follow-up if it annoys: dev-api passes the key owner through
  a move RPC.
- Status changes made outside the board on a project-tagged task still notify
  (they ARE board activity — the 113 trigger moves the card anyway).
- No per-user mute for busy projects yet; `email_digest_enabled` still governs
  email. A `project_members.muted` flag is the natural follow-up if volume
  becomes a complaint.

## Apply order

1. Migration `119_project_activity_notifications.sql` (Management API — token
   needed; 116 stays reserved, 119 is next free after 118).
2. Deploy `notification-digest` (`npx supabase functions deploy
   notification-digest --no-verify-jwt --project-ref urdzocyfxgyhqmoqbuvk`).
3. Ship frontend (Vercel).
Frontend is safe to ship before/after the migration: hook no-ops on zero rows,
and outbox rows created before the frontend ships simply age out.
