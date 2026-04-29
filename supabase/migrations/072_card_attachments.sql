-- ─────────────────────────────────────────────
-- 072 · Inline images + generic file attachments on cards & comments
--
-- Lets users paste/upload screenshots into Card notes and comments
-- (RichInput's existing inline-image flow, same as hub message board /
-- DMs), and attach arbitrary files (PDFs, docs, etc.) to either.
--
-- Schema: jsonb arrays on the existing rows, mirroring the pattern from
-- migrations 022/025/027 (hub_messages, hub_todo_items, dm_messages all
-- carry their own `inline_images jsonb`). No new tables — files live
-- in the existing `hub-files` Storage bucket.
--
-- inline_images shape:  [{ storage_path, mime_type, width, height }]
-- attachments shape:    [{ storage_path, file_name, mime_type, size }]
--
-- Both default to '[]'. Existing rows are unaffected.
-- ─────────────────────────────────────────────

alter table public.hub_cards
  add column if not exists inline_images jsonb not null default '[]'::jsonb,
  add column if not exists attachments   jsonb not null default '[]'::jsonb;

alter table public.comments
  add column if not exists inline_images jsonb not null default '[]'::jsonb,
  add column if not exists attachments   jsonb not null default '[]'::jsonb;
