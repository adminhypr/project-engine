-- ─────────────────────────────────────────────
-- 067 · Sync existing hub conversation titles to their module titles
--
-- Migration 064 created one kind='hub' conversation per hub with title
-- set to the hub's name (e.g. "Team Aries - Test Hub"). Migration 066
-- linked those rows to their campfire modules via module_id but did not
-- rewrite the title — so existing campfires appear in the chat widget
-- under the hub name instead of "Campfire", while newly added campfires
-- (created via the trigger create_hub_chat_on_module_insert) correctly
-- carry the module's own title.
--
-- This catches up the legacy rows so every kind='hub' conversation shows
-- as the module title. Going forward, the sync_hub_module_conversation_title
-- trigger keeps them in lockstep on rename.
-- ─────────────────────────────────────────────

update public.conversations c
   set title = m.title
  from public.hub_modules m
 where c.kind = 'hub'
   and c.module_id = m.id
   and m.kind = 'campfire'
   and (c.title is null or c.title <> m.title);
