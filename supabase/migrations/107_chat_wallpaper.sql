-- ─────────────────────────────────────────────
-- 107 · Per-conversation SHARED chat wallpaper (Telegram-style)
--
-- Whoever sets a wallpaper changes it for EVERYONE in that conversation.
-- This is the shared-state model (not per-user), so the value lives on the
-- conversations row, not on conversation_participants.
--
-- New columns on public.conversations (all nullable, additive):
--   wallpaper         text         — null = no wallpaper. Otherwise a scheme-
--                                    prefixed string the frontend resolves:
--                                      'preset:<key>'   → a CSS gradient preset
--                                      'upload:<path>'  → a dm-attachments object
--                                                         path, signed for display
--   wallpaper_set_by  uuid         — attribution; FK profiles(id) ON DELETE SET NULL
--   wallpaper_set_at  timestamptz  — when it was last changed
--
-- ── RLS (why this is safe + non-recursive) ───────────────────────────
-- A conversation PARTICIPANT must be able to UPDATE these columns. The
-- conversations UPDATE policy ALREADY permits participants:
--   • 027 created `conversations_update_participant` USING is_conversation_participant(id)
--   • 042 re-created it WITH CHECK (is_conversation_participant(id)
--          AND (not external OR (kind='group' AND team_id not null)))
-- So no NEW policy and no widening is required — an INTERNAL participant
-- (Staff/Manager/Admin) updating the wallpaper columns passes the existing
-- USING + WITH CHECK unchanged (the `not external` branch is TRUE, so the
-- check short-circuits regardless of columns written).
--
-- KNOWN LIMITATION (intentional, not a regression): WITH CHECK re-evaluates the
-- WHOLE resulting row, not just changed columns. For an EXTERNAL user (Agent/
-- Client) the predicate reduces to `(kind='group' AND team_id IS NOT NULL)`, so
-- an external can only set a wallpaper in a team default group — NOT in dm /
-- hub / task / custom-group conversations (the write is rejected by RLS; the UI
-- shows a toast). Widening external wallpaper writes would require column-scoped
-- UPDATE enforcement (a BEFORE UPDATE trigger like guard_task_assignee_self_update,
-- migration 044) rather than loosening the policy — deferred as a product call.
-- Internal users — the primary audience for this internal tool — are unaffected.
--
-- The participant check is the SECURITY DEFINER, search_path-locked helper
-- `is_conversation_participant(cid)` from migration 027 (language sql, stable).
-- It reads conversation_participants directly; conversation_participants'
-- own policies do NOT reference conversations, so there is no policy cycle.
-- (Verified against 027 / 042 — same pattern the existing UPDATE policy uses.)
--
-- ── Storage ──────────────────────────────────────────────────────────
-- Uploaded wallpapers reuse the existing `dm-attachments` bucket at path
-- `{conversationId}/wallpaper/<uuid>.<ext>`. That bucket's RLS (027) keys on
-- the FIRST folder segment = conversation id via is_conversation_participant,
-- so participants can already read/insert there. NO new bucket, NO new policy.
--
-- ── Realtime ─────────────────────────────────────────────────────────
-- `conversations` is ALREADY in the supabase_realtime publication (added in
-- 027). UPDATE events therefore already broadcast, so participants receive
-- wallpaper changes live. The DO-block guard below makes the add idempotent
-- in case a fresh DB hasn't run 027's add yet (re-adding an existing table to
-- a publication raises an error, so we guard it).
--
-- ── Title sync (067/064) ─────────────────────────────────────────────
-- Untouched. The wallpaper columns are independent of title; the
-- sync_hub_module_conversation_title trigger only writes `title`.
--
-- Purely additive + reversible.
--   ROLLBACK:
--     alter table public.conversations
--       drop column if exists wallpaper,
--       drop column if exists wallpaper_set_by,
--       drop column if exists wallpaper_set_at;
--   (No helper or policy was created here, so nothing else to undo. Leaving
--    `conversations` in the realtime publication is harmless.)
-- ─────────────────────────────────────────────

alter table public.conversations
  add column if not exists wallpaper text;

alter table public.conversations
  add column if not exists wallpaper_set_by uuid references public.profiles(id) on delete set null;

alter table public.conversations
  add column if not exists wallpaper_set_at timestamptz;

-- Ensure conversations UPDATE events are broadcast over realtime (idempotent).
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end
$$;
