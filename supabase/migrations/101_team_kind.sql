-- ─────────────────────────────────────────────
-- 101 · Add `kind` column to teams (Internal / External division)
--
-- Settings page needs to visually separate company-internal teams
-- (Finance, HR, Marketing, ...) from client-facing external teams
-- (Client 1 Project, TEST - Agentboard, ...). The classification is
-- a manual flag set by Admin — purpose-of-team, not derived from
-- current membership.
--
-- Purely additive:
--   * New column with default 'internal' (existing rows backfill via default)
--   * Check constraint enforces the two allowed values
--   * No new RLS — `"Admins can manage teams"` (001, `for all`) already
--     gates UPDATE for non-Admin callers
--   * No edge functions / cron / spawn paths read this column
--   * Existing queries that select specific columns (`id, name, ...`) are
--     unaffected; queries that `select *` get one extra harmless column
--
-- Rollback: `alter table public.teams drop column kind` — clean, no data
-- loss (kind is metadata only, doesn't drive any FK or behaviour).
-- ─────────────────────────────────────────────

alter table public.teams
  add column if not exists kind text not null default 'internal'
  check (kind in ('internal', 'external'));

comment on column public.teams.kind is
  'Team classification — ''internal'' (company team) or ''external'' (client team). Admin-set; defaults to internal on insert.';
