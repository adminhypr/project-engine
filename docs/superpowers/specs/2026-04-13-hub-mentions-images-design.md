# Hub @Mentions & Inline Image Paste — Design Spec

**Date:** 2026-04-13
**Approach:** Textarea + overlay autocomplete + image preview strip (Approach A)

---

## Overview

Add two features to Project Hub inputs:

1. **@mentions** — type `@` to autocomplete and tag hub members. Mentioned users receive in-app notifications (NotificationBell) and email alerts.
2. **Inline image paste/drop** — paste screenshots from clipboard or drag-and-drop image files. Images render inline when viewing the message.

## Scope

### Inputs that get @mentions:
- Campfire chat (textarea)
- Message board posts (body textarea)
- Message board replies (single-line input)
- Check-in responses (single-line input)

### Inputs that get image paste/drop:
- Campfire chat (textarea)
- Message board posts (body textarea)
- Message board replies (single-line input)

### Inputs excluded:
- Event form (title, description) — structured/label data
- Check-in prompt creation — manager template, not conversational
- Message board title — short label field
- Check-in responses — text-only answers, no images

---

## 1. Data Model

### Schema changes to existing tables

**`hub_chat_messages`:**
```
+ mentions       jsonb  default '[]'   -- [{user_id, display_name}]
+ inline_images  jsonb  default '[]'   -- [{file_id, storage_path, file_name, mime_type}]
```

**`hub_messages`:**
```
+ mentions       jsonb  default '[]'
+ inline_images  jsonb  default '[]'
```

**`hub_check_in_responses`:**
```
+ mentions       jsonb  default '[]'
(no inline_images — check-in responses don't get image support)
```

### New table: `hub_mentions`

```sql
hub_mentions (
  id              uuid PRIMARY KEY default gen_random_uuid(),
  hub_id          uuid NOT NULL REFERENCES hubs(id) ON DELETE CASCADE,
  mentioned_by    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mentioned_user  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type     text NOT NULL,  -- 'chat', 'message', 'message_reply', 'check_in_response'
  entity_id       uuid NOT NULL,
  seen            boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
)
```

**Indexes:**
- `(mentioned_user, seen)` — fast lookup for "my unread mentions"
- `(entity_type, entity_id)` — fast cleanup on message delete

**RLS policies:**
- SELECT: users can read rows where `mentioned_user = auth.uid()`
- INSERT: hub members can insert mentions for their hub
- UPDATE: users can update `seen` on their own mentions
- DELETE: app-level cleanup when source message is deleted (no FK on `entity_id` since it references multiple tables). Each delete handler in `useHubChat`, `useHubMessages`, `useHubCheckIns` must also delete matching `hub_mentions` rows by `(entity_type, entity_id)`.

### Migration file

`supabase/migrations/021_hub_mentions.sql`

---

## 2. Shared RichInput Component

**New file:** `src/components/ui/RichInput.jsx`

A reusable component that wraps a `<textarea>` with mention autocomplete and image paste/drop behavior.

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | string | — | Controlled text state |
| `onChange` | fn | — | Text change handler |
| `onSubmit` | fn | — | Called with `{ content, mentions, inlineImages }` |
| `hubId` | uuid | — | Used to fetch hub members for autocomplete |
| `enableMentions` | bool | `true` | Toggle mention support |
| `enableImages` | bool | `true` | Toggle image support |
| `placeholder` | string | — | Textarea placeholder |
| `rows` | number | — | Textarea rows |
| `className` | string | — | Pass-through class |
| `singleLine` | bool | `false` | Renders as single-line input style |

### Mention autocomplete behavior

- Typing `@` opens a floating dropdown positioned near the cursor
- Dropdown shows hub members filtered by text typed after `@`, using `full_name` ilike matching
- Each entry shows avatar + display name
- Arrow keys to navigate, Enter or click to select
- Selecting inserts `@DisplayName` into the textarea text and adds `{user_id, display_name}` to internal mentions array
- Escape or clicking away closes the dropdown
- Dropdown limited to 6 results
- Member list sourced from `useHubMembers` hook (already available)

### Image paste/drop behavior

- `onPaste` handler checks `clipboardData.items` for `image/*` types
- `onDragOver` / `onDrop` handlers accept image files
- Validation: must be `image/*` mime type, max 5MB per file
- Rejected files show a toast error via `showToast`
- Uploads to `hub-files` bucket at path `{hub_id}/inline/{uuid}_{filename}`
- During upload: thumbnail preview with loading indicator shown below textarea
- Once uploaded: metadata inserted into `hub_files` table (reuses existing pattern), then added to internal `inlineImages` array using the `hub_files.id` as `file_id`
- User can remove images before sending (X button on thumbnail — also deletes from storage + `hub_files`)
- Multiple images allowed per message

### onSubmit payload

```js
{
  content: "Hey @Jane Smith check this out",
  mentions: [{ user_id: "uuid-123", display_name: "Jane Smith" }],
  inlineImages: [{ file_id: "uuid-456", storage_path: "hub-id/inline/uuid_screenshot.png", file_name: "screenshot.png", mime_type: "image/png" }]
}
```

---

## 3. Rich Content Renderer

**New file:** `src/components/ui/RichContentRenderer.jsx`

Takes plain text + mentions + inline images and renders rich content for display.

### Props

| Prop | Type | Description |
|------|------|-------------|
| `content` | string | The plain text string |
| `mentions` | array | `[{user_id, display_name}]` |
| `inlineImages` | array | `[{file_id, storage_path, file_name, mime_type}]` |

### Mention rendering

- Scans `content` for each `@DisplayName` matching an entry in the `mentions` array
- Replaces with a styled `<span>` — subtle background color, slightly bold
- Non-matching `@` text left as-is (no false positives)
- Mention chips are non-interactive (no click-to-profile)

### Image rendering

- Images render after the text block as a stacked inline gallery
- Each image loaded via signed URL from `hub-files` bucket (1-hour expiry)
- Lazy loading via `loading="lazy"` attribute
- Click opens full-size view in existing `ModalWrapper` component
- Failed loads show a fallback placeholder
- Signed URLs cached in component state to avoid re-signing on every render

### Where it replaces current plain text rendering

- `Campfire.jsx` — chat message bubbles (currently `whitespace-pre-wrap` on `content`)
- `MessageBoard.jsx` / `MessageThread.jsx` — post body and reply text
- `CheckIns.jsx` — check-in response display
- `ActivityFeed.jsx` — stays plain text (truncated previews, not full content)

---

## 4. Notification System

### In-app (NotificationBell)

- Extend `NotificationBell` to query `hub_mentions` where `mentioned_user = auth.uid() AND seen = false`
- Notification format: `"@JaneSmith mentioned you in Hub Name — Campfire"`
- Clicking navigates to the hub page
- Marking as read sets `hub_mentions.seen = true`
- Real-time: add `postgres_changes` subscription on `hub_mentions` filtered by `mentioned_user = auth.uid()`

### New hook: `src/hooks/useMentionNotifications.js`

- Subscribes to realtime `hub_mentions` inserts for current user
- Provides `unreadMentionCount` and `mentions` list
- Provides `markSeen(mentionId)` and `markAllSeen()` methods
- Used by `NotificationBell` component

### Email (new edge function)

**New file:** `supabase/functions/hub-mention-notify/index.ts`

- Triggered by database webhook on `hub_mentions` INSERT
- Fetches: mentioned user's email, mentioner's name, hub name, message content preview
- Sends via Resend (same pattern as existing `notify` function)
- Email subject: `"You were mentioned in {hub_name}"`
- Email body: who mentioned, which module (Campfire/Message Board/Check-in), content preview, link to hub
- Skips if `mentioned_by = mentioned_user` (self-mention)

### Who writes to `hub_mentions`?

Application-level inserts, not DB triggers. After inserting a chat message / message board post / reply / check-in response, the parent component batch-inserts into `hub_mentions` — one row per unique user in the mentions array.

---

## 5. Component Integration

### Components adopting RichInput

| Component | Current Element | RichInput Config |
|-----------|----------------|-----------------|
| `ChatInput.jsx` | `<textarea>` | `enableMentions enableImages` |
| `MessageComposer.jsx` | body `<textarea>` | `enableMentions enableImages` (title stays plain `<input>`) |
| `MessageThread.jsx` | reply `<input>` | `singleLine enableMentions enableImages` |
| `CheckInResponseForm.jsx` | `<input>` | `singleLine enableMentions enableImages={false}` |

### Components adopting RichContentRenderer

| Component | Current Rendering | Change |
|-----------|------------------|--------|
| `Campfire.jsx` | `whitespace-pre-wrap` on `content` | `<RichContentRenderer content mentions inlineImages />` |
| `MessageThread.jsx` | `whitespace-pre-wrap` on `content` | `<RichContentRenderer content mentions inlineImages />` |
| `MessageBoard.jsx` | `whitespace-pre-wrap` on `content` | `<RichContentRenderer content mentions inlineImages />` |
| `CheckIns.jsx` | Plain text display | `<RichContentRenderer content mentions />` (no images) |

### Hooks modified

| Hook | Change |
|------|--------|
| `useHubChat.js` | Include `mentions`, `inline_images` in select and insert |
| `useHubMessages.js` | Include `mentions`, `inline_images` in select and insert |
| `useHubCheckIns.js` | Include `mentions` in select and upsert |

---

## 6. Edge Cases

- **Deleted messages:** `hub_mentions` rows cleaned up app-level — each hook's delete function also deletes matching `hub_mentions` by `(entity_type, entity_id)`. Inline images cleaned up from storage + `hub_files` table.
- **Duplicate mentions:** If `@Jane` appears 3 times in one message, only one `hub_mentions` row created (deduplicate by `mentioned_user` per entity)
- **Member leaves hub:** Existing mentions remain. New mentions can't be created (autocomplete only shows current members)
- **Large images:** Rejected client-side before upload if over 5MB, toast error shown
- **Non-image drag:** Ignored — only `image/*` mime types accepted
- **Existing messages:** Old messages have `mentions: []` and `inline_images: []` defaults. `RichContentRenderer` renders plain text as before
- **Activity feed:** Summaries stay plain text. `@DisplayName` appears as raw text in feed
- **Self-mention:** Autocomplete includes current user (natural to reference yourself), but no notification is sent

---

## 7. File Inventory

| Type | Path | Status |
|------|------|--------|
| Migration | `supabase/migrations/021_hub_mentions.sql` | New |
| Component | `src/components/ui/RichInput.jsx` | New |
| Component | `src/components/ui/RichContentRenderer.jsx` | New |
| Hook | `src/hooks/useMentionNotifications.js` | New |
| Edge Function | `supabase/functions/hub-mention-notify/index.ts` | New |
| Component | `src/components/hub/ChatInput.jsx` | Modified |
| Component | `src/components/hub/MessageComposer.jsx` | Modified |
| Component | `src/components/hub/MessageThread.jsx` | Modified |
| Component | `src/components/hub/CheckInResponseForm.jsx` | Modified |
| Component | `src/components/hub/Campfire.jsx` | Modified |
| Component | `src/components/hub/MessageBoard.jsx` | Modified (if separate) |
| Component | `src/components/hub/CheckIns.jsx` | Modified |
| Component | `src/components/ui/NotificationBell` (or equivalent) | Modified |
| Hook | `src/hooks/useHubChat.js` | Modified |
| Hook | `src/hooks/useHubMessages.js` | Modified |
| Hook | `src/hooks/useHubCheckIns.js` | Modified |

### Storage

- Bucket: `hub-files` (existing, reused)
- Inline image path: `{hub_id}/inline/{uuid}_{filename}`
- Max file size: 5MB
- No new bucket needed
