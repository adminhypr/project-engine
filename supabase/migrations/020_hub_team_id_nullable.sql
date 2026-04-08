-- ============================================================
-- Migration 020: Fix hub tables for hub-first access
-- 1. Make team_id nullable (hub_id is the real FK now)
-- 2. Add missing hub-based RLS policies for INSERT/UPDATE/DELETE
-- 3. Reload PostgREST schema cache
-- ============================================================

-- 1. Make team_id nullable on hub content tables
ALTER TABLE public.hub_activity ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE public.hub_chat_messages ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE public.hub_messages ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE public.hub_check_in_prompts ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE public.hub_events ALTER COLUMN team_id DROP NOT NULL;

-- 2. Hub-based INSERT for check_in_prompts (was missing — caused 403)
CREATE POLICY check_in_prompts_insert_by_hub ON public.hub_check_in_prompts
  FOR INSERT WITH CHECK (
    created_by = auth.uid() AND is_hub_member(hub_id)
  );

-- 3. Hub-based INSERT + SELECT for check_in_responses
CREATE POLICY check_in_responses_insert_by_hub ON public.hub_check_in_responses
  FOR INSERT WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM hub_check_in_prompts p
      WHERE p.id = hub_check_in_responses.prompt_id AND is_hub_member(p.hub_id)
    )
  );

CREATE POLICY check_in_responses_select_by_hub ON public.hub_check_in_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM hub_check_in_prompts p
      WHERE p.id = hub_check_in_responses.prompt_id AND is_hub_member(p.hub_id)
    )
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'Admin')
  );

-- 4. Hub-based DELETE/UPDATE for messages
CREATE POLICY hub_messages_delete_by_hub ON public.hub_messages
  FOR DELETE USING (
    author_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'Admin')
  );

CREATE POLICY hub_messages_update_by_hub ON public.hub_messages
  FOR UPDATE USING (
    author_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'Admin')
  );

-- 5. Hub-based DELETE/UPDATE for events
CREATE POLICY hub_events_delete_by_hub ON public.hub_events
  FOR DELETE USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'Admin')
  );

CREATE POLICY hub_events_update_by_hub ON public.hub_events
  FOR UPDATE USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'Admin')
  );

-- 6. Hub-based UPDATE for check_in_prompts
CREATE POLICY check_in_prompts_update_by_hub ON public.hub_check_in_prompts
  FOR UPDATE USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'Admin')
  );

-- 7. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
