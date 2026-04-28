-- ─────────────────────────────────────────────
-- 065 · Remove Check-ins and Schedule modules from hubs
--
-- Hubs no longer expose Check-ins or Schedule. This migration drops the
-- supporting tables, their dependent triggers/functions, and cleans up
-- residual references in hub_mentions / hub_activity.
--
-- Tables dropped (CASCADE — removes attached triggers, policies, indexes):
--   · hub_check_in_responses
--   · hub_check_in_prompts
--   · hub_events
--
-- Functions dropped:
--   · hub_activity_on_check_in()  (trigger fn — trigger goes with table)
--   · hub_activity_on_event()     (trigger fn — trigger goes with table)
--
-- Side cleanup:
--   · hub_mentions rows with entity_type='check_in_response' point at
--     deleted check-in responses; delete them.
--   · hub_activity rows referencing the dropped entity types stay around
--     as a historical feed (no FK in that table). Delete them too so the
--     activity stream doesn't surface dangling links.
-- ─────────────────────────────────────────────

-- 1. Mentions cleanup (hub-mention-notify still has a dead branch for
--    'check_in_response'; with no rows it can't fire).
delete from public.hub_mentions where entity_type = 'check_in_response';

-- 2. Activity feed cleanup — remove records that pointed to dropped
--    entities. Keep message-board / todo / chat history intact.
delete from public.hub_activity where entity_type in ('check_in_response', 'event');

-- 3. Drop the tables. CASCADE removes:
--      · the per-table triggers (hub_activity_on_check_in / on_event)
--      · all RLS policies attached
--      · indexes
--      · realtime publication membership (hub_events was added in 015)
drop table if exists public.hub_check_in_responses cascade;
drop table if exists public.hub_check_in_prompts cascade;
drop table if exists public.hub_events cascade;

-- 4. Drop the now-orphan trigger functions. CASCADE on the tables removed
--    the triggers themselves; the functions remain unused otherwise.
drop function if exists public.hub_activity_on_check_in() cascade;
drop function if exists public.hub_activity_on_event() cascade;
