-- ─────────────────────────────────────────────
-- 087 · tasks.urgency CHECK allows 'Urgent'
--
-- Pre-existing bug surfaced by migration 079 (atomic recurring-task
-- spawn). task_recurrences.template_urgency (058:24) allows 'Urgent',
-- but tasks.urgency CHECK (001:65-66) only allows Low/Med/High. A
-- recurring template with template_urgency='Urgent' would fail the
-- CHECK inside the spawn_recurrence transaction, surfacing as
-- `tasks_urgency_check` violation and rolling back the entire spawn.
--
-- Frontend already lets users pick 'Urgent' on recurrence templates
-- (RecurrenceEditorModal.jsx:12), so the gap is observable today.
-- This migration extends the CHECK to include 'Urgent' so:
--   • recurring spawns of Urgent templates succeed.
--   • users can manually set urgency='Urgent' on regular tasks too
--     (no UI surfaces this yet, but it's no longer a DB blocker).
--
-- Order constants in the new CHECK match the visual rank Low <
-- Med < High < Urgent so any sort/comparison helpers downstream
-- can use the array order if needed.
-- ─────────────────────────────────────────────

alter table public.tasks
  drop constraint if exists tasks_urgency_check;

alter table public.tasks
  add constraint tasks_urgency_check
  check (urgency in ('Low', 'Med', 'High', 'Urgent'));
