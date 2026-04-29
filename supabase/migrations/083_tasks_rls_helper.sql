-- ─────────────────────────────────────────────
-- 083 · is_task_visible helper + RLS rewrite
--
-- Replaces the inline EXISTS-soup in the tasks SELECT policy with a
-- single SECURITY DEFINER STABLE function call. Postgres caches STABLE
-- function results within a query, so the per-row cost drops from
-- "4+ subqueries per row" to "1 cached call per (caller, row) pair".
--
-- The visibility predicate already lives in `can_user_see_task(p_user,
-- p_task)` from migration 076 — we wrap it in a thin nullary alias
-- `is_task_visible(p_task)` that fills in `auth.uid()` so the RLS
-- expression stays short.
--
-- ─── Pre-apply verification ──────────────────────────────────────────
-- Before applying, confirm the live SELECT policy name matches the
-- DROP statement below by running:
--
--   select polname
--     from pg_policy
--    where polrelid = 'public.tasks'::regclass
--      and polcmd = 'r';
--
-- Expected result (single row): "Task visibility by role"
--
-- This name is set by migration 001 and re-asserted by 011 + 039 — no
-- later migration renames or splits it. If the audit query returns a
-- DIFFERENT name (or multiple rows), update the DROP statements below
-- before applying — PostgreSQL ORs multiple SELECT policies, so missing
-- one would leave the legacy predicate active alongside the new helper.
-- ─────────────────────────────────────────────

-- ─────────────────────────────────────────────
-- Helper: is_task_visible(p_task)
--
-- Wraps can_user_see_task(auth.uid(), p_task) from 076. SECURITY
-- DEFINER + STABLE so the planner can hoist + cache calls per row.
-- ─────────────────────────────────────────────
create or replace function public.is_task_visible(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_user_see_task(auth.uid(), p_task)
$$;

revoke all on function public.is_task_visible(uuid) from public;
grant execute on function public.is_task_visible(uuid) to authenticated;

-- ─────────────────────────────────────────────
-- Replace the legacy SELECT policy with a helper-backed version.
--
-- Live policy name (verified 2026-04-29 by reading 001/011/039/042/051):
--   "Task visibility by role"   ← from 001, last redefined in 039
--
-- Defensive fallback drops cover historical names from earlier
-- iterations of 011 (in case any environment still carries them):
--   "task_visibility_with_per_team_roles"  (011's fallback)
--   "tasks_select"                         (this migration's own re-runs)
-- ─────────────────────────────────────────────
drop policy if exists "Task visibility by role" on public.tasks;
drop policy if exists "task_visibility_with_per_team_roles" on public.tasks;
drop policy if exists "tasks_select" on public.tasks;

create policy "tasks_select" on public.tasks for select
  using (public.is_task_visible(id));
