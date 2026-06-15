-- ─────────────────────────────────────────────
-- 105 · Chat file attachments
--
-- Adds generic (non-image) file attachments to chat messages across ALL
-- chat surfaces — campfire (kind='hub') and the widget (kind='dm'/'group'/
-- 'task'). All of these are dm_messages rows on a conversations row gated
-- by conversation_participants, so they share ONE storage bucket:
-- dm-attachments (created in 027, no MIME allowlist → accepts any type).
--
-- The hub-files bucket and its migration-077 allowlist are deliberately
-- LEFT UNTOUCHED, so the docs/files module, card attachments, and inline
-- images keep their XSS protection. The XSS vector for arbitrary types is
-- instead closed at RENDER time: chat attachment chips open via a signed
-- URL with { download: file_name } (Content-Disposition: attachment), so a
-- hostile .html/.svg downloads instead of executing. Inline previews stay
-- raster-image-only (see src/lib/chatAttachments.js:isInlineImage).
--
-- Purely additive: one nullable-defaulted jsonb column + a size-limit bump
-- on the chat bucket only. No RLS / trigger / constraint changes. Existing
-- rows get '[]'. Old clients ignore the unknown column. Reversible.
--
-- Attachment descriptor shape (matches card FileAttachments):
--   { storage_path, file_name, mime_type, size }
-- Object path convention (required by the 027 dm-attachments RLS, which
-- keys on the first folder segment = conversation id):
--   {conversationId}/{uuid}/{sanitizedFilename}
-- ─────────────────────────────────────────────

alter table public.dm_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Raise the chat bucket cap from 5 MB (027) so real files (video, large
-- PDFs) fit. Affects dm-attachments ONLY — hub-files is unchanged.
update storage.buckets
   set file_size_limit = 26214400 -- 25 MB
 where id = 'dm-attachments';
