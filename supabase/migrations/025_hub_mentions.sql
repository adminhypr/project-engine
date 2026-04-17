-- ============================================================
-- Migration 021: Hub @mentions + inline images
-- Adds JSONB metadata columns for mentions and inline images
-- to hub content tables, plus a hub_mentions notification table.
-- ============================================================

-- 1. Add JSONB columns to existing tables
ALTER TABLE hub_chat_messages
  ADD COLUMN IF NOT EXISTS mentions      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS inline_images jsonb DEFAULT '[]'::jsonb;

ALTER TABLE hub_messages
  ADD COLUMN IF NOT EXISTS mentions      jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS inline_images jsonb DEFAULT '[]'::jsonb;

ALTER TABLE hub_check_in_responses
  ADD COLUMN IF NOT EXISTS mentions      jsonb DEFAULT '[]'::jsonb;

-- 2. Hub mentions notification table
CREATE TABLE IF NOT EXISTS hub_mentions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id          uuid NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  mentioned_by    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mentioned_user  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type     text NOT NULL,
  entity_id       uuid NOT NULL,
  seen            boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_mentions_user_seen
  ON hub_mentions(mentioned_user, seen);
CREATE INDEX IF NOT EXISTS idx_hub_mentions_entity
  ON hub_mentions(entity_type, entity_id);

-- 3. RLS policies for hub_mentions
ALTER TABLE hub_mentions ENABLE ROW LEVEL SECURITY;

-- Users can read their own mentions
CREATE POLICY hub_mentions_select ON hub_mentions
  FOR SELECT USING (mentioned_user = auth.uid());

-- Hub members can insert mentions for their hub
CREATE POLICY hub_mentions_insert ON hub_mentions
  FOR INSERT WITH CHECK (
    mentioned_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM hub_members
      WHERE hub_members.hub_id = hub_mentions.hub_id
      AND hub_members.profile_id = auth.uid()
    )
  );

-- Users can mark their own mentions as seen
CREATE POLICY hub_mentions_update ON hub_mentions
  FOR UPDATE USING (mentioned_user = auth.uid())
  WITH CHECK (mentioned_user = auth.uid());

-- Users can delete their own mentions
CREATE POLICY hub_mentions_delete ON hub_mentions
  FOR DELETE USING (mentioned_by = auth.uid());

-- 4. Enable realtime on hub_mentions
ALTER PUBLICATION supabase_realtime ADD TABLE hub_mentions;

-- 5. Notify PostgREST to pick up schema changes
NOTIFY pgrst, 'reload schema';
