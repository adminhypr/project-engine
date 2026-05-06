-- ─────────────────────────────────────────────
-- 102 · Defensive reset of task_audit_log event_type CHECK constraint
--
-- Symptom (reported 2026-05-05/06): adding a sub-task fails with
--   new row for relation "task_audit_log" violates check constraint
--   "task_audit_log_event_type_check"
-- (HTTP 400 from PostgREST on POST /rest/v1/tasks?select=*).
--
-- Source-code review of every INSERT INTO task_audit_log site (002, 003,
-- 012, 036, 044, 050, 051, 053, 056, 058, 079, 088, frontend
-- useTasks.jsx) confirmed every event_type written is in migration 058's
-- constraint list. Couldn't reproduce locally because no Docker /
-- supabase db dump access.
--
-- Most likely root cause: prod constraint has drifted from migration
-- source (dashboard edit, partial migration apply, or some other
-- out-of-band change). NOT VALID flag means existing bad rows aren't
-- validated, but new INSERTs ARE checked.
--
-- Fix: drop and recreate the constraint with the canonical complete
-- list of every event_type any trigger or app code writes. Idempotent —
-- if the constraint is already correct, this is a no-op-ish round-trip.
--
-- Canonical list (20 values):
--   002  task_created
--   012  status_changed, urgency_changed, due_date_changed, notes_updated, reassigned
--   003  accepted, declined
--   044  assigner_override (frontend useTasks.jsx)
--   044  assignee_marked_done, assignee_unmarked, force_closed, all_assignees_completed
--   053  subtask_added, subtask_removed, parent_auto_closed_via_subtasks, force_closed_with_open_subtasks
--   056  dependency_added, dependency_removed
--   079  recurring_spawned
--
-- If this migration applies and the user STILL hits the error, the
-- offending event_type is something we haven't seen in source — pull
-- the 23514 error's `details` line from PostgREST response (shows
-- "Failing row contains (...)") to identify and fix the source.
-- ─────────────────────────────────────────────

alter table public.task_audit_log
  drop constraint if exists task_audit_log_event_type_check;

alter table public.task_audit_log
  add constraint task_audit_log_event_type_check
  check (event_type in (
    'task_created',
    'status_changed',
    'urgency_changed',
    'due_date_changed',
    'notes_updated',
    'reassigned',
    'accepted',
    'declined',
    'assigner_override',
    'assignee_marked_done',
    'assignee_unmarked',
    'force_closed',
    'all_assignees_completed',
    'subtask_added',
    'subtask_removed',
    'parent_auto_closed_via_subtasks',
    'force_closed_with_open_subtasks',
    'dependency_added',
    'dependency_removed',
    'recurring_spawned'
  )) not valid;
