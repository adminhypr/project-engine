-- ─────────────────────────────────────────────
-- 098 · Loosen task_recurrences_insert to match tasks_insert parity
--
-- Real prod bug: Manager creating a recurring task for a cross-team
-- assignee fails with
--   42501: new row violates row-level security policy for table "task_recurrences"
-- The same Manager creating a NON-recurring (one-shot) task for the
-- same assignee succeeds — tasks_insert is permissive
-- (`auth.role()='authenticated' AND NOT is_external_user(auth.uid())`).
--
-- Reproduced: Paula (Manager on team 27dbf8f4) creating a recurring
-- template with team_id = e4dbd97d (David's team) → 42501. Same INSERT
-- with team_id = her team or team_id = NULL → succeeds.
--
-- Root cause: migration 058's task_recurrences_insert WITH CHECK
-- requires the creator to be (Admin OR team_id IS NULL OR
-- Manager/TeamLeader on the SELECTED team). The third condition is
-- the trap — Managers naturally pick a team_id matching their
-- assignee's team, but the policy demands they be Manager on THAT
-- specific team. Cross-team Manager assignments are valid for regular
-- tasks (the AssignmentType='CrossTeam' flow) so the recurring path
-- should match.
--
-- Fix: drop the team-specific clause. Any non-external authenticated
-- user can create a recurring template (mirrors tasks_insert). The
-- task_recurrences_update / _delete policies stay restrictive
-- (Admin OR creator OR Manager-on-team), so an over-eager Manager
-- can't later EDIT a template they shouldn't manage. This is also
-- the policy shape that audit-task-3.5 audited as correct for the
-- one-shot tasks table.
--
-- NOT my regression — pre-existing since migration 058. Surfaced
-- only after Ian started using cross-team recurring tasks today.
-- ─────────────────────────────────────────────

drop policy if exists task_recurrences_insert on public.task_recurrences;

create policy task_recurrences_insert on public.task_recurrences
  for insert
  with check (
    auth.uid() = created_by
    and not coalesce(public.is_external_user(auth.uid()), false)
  );
