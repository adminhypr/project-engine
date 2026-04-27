-- ─────────────────────────────────────────────
-- 061 · Fix RLS recursion between task_recurrences and
--      task_recurrence_assignees.
--
-- 058's SELECT policies created a cycle:
--   task_recurrences.SELECT → exists(task_recurrence_assignees…)
--   task_recurrence_assignees.SELECT → exists(task_recurrences…)
--
-- Postgres detects the loop and fails any read of either table with
-- "infinite recursion detected in policy". Same shape as the hub-RLS
-- bugs broken by migrations 013, 017, 018 — flagged in CLAUDE.md.
--
-- Fix: drop the cross-reference. v1 simplification — the "assignee
-- can SELECT the parent template" path is no longer needed because
-- assignees primarily interact with spawned tasks, not the template
-- record. Spawned tasks already have the 🔁 Recurring pill via the
-- recurrence_id FK, which they read via the existing tasks SELECT
-- policy (no recurrence-side check needed).
--
-- Creators / Admins / Team managers retain full template visibility.
-- ─────────────────────────────────────────────

drop policy if exists "task_recurrences_select" on public.task_recurrences;
create policy "task_recurrences_select"
  on public.task_recurrences for select
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'Admin')
    or created_by = auth.uid()
    or (team_id is not null and exists (
      select 1 from public.profile_teams
       where profile_id = auth.uid()
         and team_id = task_recurrences.team_id
         and role in ('Manager','TeamLeader')
    ))
    -- Assignee-visibility path removed: caused recursion with the
    -- task_recurrence_assignees SELECT policy. Assignees see spawned
    -- tasks via the tasks table, not the template directly.
  );
