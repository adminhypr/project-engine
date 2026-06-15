# Chat file attachments — design

**Date:** 2026-06-15
**Branch:** `feat/chat-file-attachments`
**Status:** Design approved, ready for implementation

## Goal

Let users attach **any file type** in chats — campfire (hub) chat **and** the widget
(1:1 DMs, group chats, task chats). Images preview inline (existing behavior); all
other files attach as named download chips. Must not regress security or impact
other features (docs/files module, card attachments, inline images).

## Problem (today)

- Campfire's paperclip only accepts images: `ChatInput` → `RichInput` with
  `enableImages`, file input hardcoded `accept="image/*"`, and `uploadImage()`
  bails on non-images. A PDF literally can't be picked.
- The widget composer (`ChatComposer`) only accepts **pasted** images — no picker.
- `dm_messages` has `inline_images` but **no `attachments` column**.
- `ChatMessage` / `DmChatMessage` render only `inline_images`.

## Key insight — one bucket for all chat, no `hub-files` change

Every chat surface is the same plumbing: a `dm_messages` row on a `conversations`
row, gated by `conversation_participants`. Campfire (`kind='hub'`) included — hub
members are already participants.

So all chat file attachments use the existing **`dm-attachments`** bucket:

- It already has **no MIME allowlist** → accepts any file type today. "Allow all
  types" needs **zero** allowlist change.
- We never touch `hub-files`, so the docs module, card attachments, and inline
  images keep migration 077's XSS protection fully intact.
- Its RLS (`is_conversation_participant((storage.foldername(name))[1]::uuid)`)
  already works for campfire because campfire members are participants.

### Safety control is at RENDER, not upload

Attachment chips open via a **forced-download** signed URL:

```js
supabase.storage.from(bucket).createSignedUrl(path, 3600, { download: file_name })
```

`Content-Disposition: attachment` makes a hostile `.html`/`.svg`/`.js` **download
instead of execute** — the XSS vector is dead regardless of file type. Inline
previews stay raster-image-only, so SVG can be uploaded/shared but never rendered
inline. This is strictly safer than removing the `hub-files` allowlist (which would
also have required hardening the docs/cards open paths).

## Data model

Migration `105_dm_message_attachments.sql` — additive only:

```sql
alter table public.dm_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

update storage.buckets set file_size_limit = 26214400 -- 25 MB
 where id = 'dm-attachments';
```

- Mirrors `inline_images` exactly. Existing rows get `[]`. Old clients ignore the
  unknown column. Reversible (`drop column`).
- Size bump only affects the chat bucket, not `hub-files`.

**Descriptor shape** (matches card `FileAttachments`):
`{ storage_path, file_name, mime_type, size }`

**Path convention** (satisfies RLS — first folder = conversation id):
`{conversationId}/{uuid}/{sanitizedFilename}`

## Upload UX

Shared component `ChatAttachmentPicker` (generalize card `FileAttachments` logic:
sanitized filenames, size guard, best-effort cleanup-on-remove). `accept="*/*"`.

**Smart routing by MIME on each picked file:**
- Raster image (png/jpeg/gif/webp/heic/heif/avif/bmp/tiff) → existing `inline_images`
  flow → inline render + lightbox.
- Everything else, **including SVG** → new `attachments` array → 📎 download chip.

SVG can't enter the inline path (non-raster) → always a force-download chip.

**Two composers, same picker:**
- Campfire (`RichInput`): keep raster-inline flow (→ `hub-files`, unchanged); add
  attachments picker (→ `dm-attachments`). `useHubChat.sendMessage` passes
  `attachments` through.
- Widget (`ChatComposer`): add file-picker button + attachments array;
  `useConversation.sendMessage` passes `attachments`.

Both send paths add `attachments: attachments.map(({ preview, ...rest }) => rest)`
to the existing insert. Send button enabled when text **or** image **or**
attachment present.

## Render

`ChatMessage` (campfire) and `DmChatMessage` (widget) already use
`RichContentRenderer`. Pass `attachments={message.attachments}` + buckets:
- Campfire: `imagesBucket="hub-files"`, `attachmentBucket="dm-attachments"`.
- Widget: both `dm-attachments`.

`RichContentRenderer` changes:
- Attachment-chip signing → forced-download (`{ download: file_name }`).
- Normalize chip shape (`storage_path`/`file_name`, currently reads `path`/`name`).
- Show file size + type icon.
- Inline images keep plain signed URL (raster = safe to render).

## Tests

`lib/chatAttachments.js` pure helper, Vitest:
- `isInlineImage(mime)` — png→true, image/svg+xml→false, application/pdf→false.
- `sanitizeFilename(name)`.
- `buildAttachmentDescriptor(...)`.

Composer/renderer verified manually (repo has no component tests).

## Rollout order (each step safe with prior live)

1. Migration (column + size bump) — inert until code ships.
2. Renderer + force-download — old messages unaffected (`attachments` defaults `[]`).
3. Composers + send paths — feature goes live.

## Out of scope

- Opening up the `hub-files` allowlist (deferred; would need docs/cards open-path
  hardening).
- Virus scanning, per-file progress bars, drag-drop zones beyond what exists.
