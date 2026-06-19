# Chat Wallpaper — Spec (per-conversation, shared)

**Date:** 2026-06-19 · Branch `complete-redesign`.
**Decision:** per-conversation, SHARED — whoever sets it changes the wallpaper for everyone in that conversation (Telegram-style). Requires a DB column + Storage + RLS + realtime.

## Data model (migration)

New migration `supabase/migrations/<next>_chat_wallpaper.sql`:
- `ALTER TABLE conversations ADD COLUMN wallpaper text;` — nullable. Stores EITHER a preset key (`'preset:neon-aurora'`) OR a storage object path (`'wallpaper:<conversationId>/<uuid>.jpg'`). Use a scheme prefix so the frontend knows how to resolve it. Null = default (no wallpaper).
- Optionally `wallpaper_set_by uuid references profiles(id)` + `wallpaper_set_at timestamptz` for attribution (nice-to-have; include — small).
- **RLS UPDATE:** conversation participants must be able to update `wallpaper`/`wallpaper_set_by`/`wallpaper_set_at`. There's an existing conversations UPDATE policy (migration 042 added WITH CHECK). Add/extend a policy so a participant (`exists in conversation_participants where conversation_id=conversations.id and user_id=auth.uid()`) can UPDATE. **RLS caution (per CLAUDE.md):** avoid recursion — use a SECURITY DEFINER helper `is_conversation_participant(cid)` if needed, or a direct EXISTS on conversation_participants (that table's policies don't reference conversations, so no cycle — verify). Restrict the update to not let externals change things they shouldn't; mirror existing conversation update permissions.
- **Storage:** new bucket `chat-wallpapers` (or reuse `dm-attachments`). If new bucket: RLS so participants of `{conversationId}` can read; uploader (participant) can insert under `{conversationId}/...`. Mirror the `hub-files` leading-folder-uuid pattern (migration 073) for the participant check, OR reuse `dm-attachments` with a `{conversationId}/wallpaper/...` path (its RLS already scopes to conversation participants — PREFER reuse to avoid a new bucket + policies). DECISION: reuse `dm-attachments` with path `{conversationId}/wallpaper/<uuid>.<ext>` (its existing RLS already gates by conversation participation). Confirm dm-attachments RLS keys on the leading conversationId folder.
- Realtime: ensure `conversations` UPDATE is broadcast (add to realtime publication if not already) so participants see wallpaper changes live. If conversations isn't in the realtime publication, add it (or refetch the conversation on a lightweight signal). Simplest: subscribe to `conversations` UPDATE for the active conversation id in the pane and update the wallpaper.

## Presets (neon)

Frontend constant `WALLPAPER_PRESETS` (no DB): a set of neon CSS gradients, e.g.
- `neon-aurora`: linear/radial purple→cyan
- `neon-sunset`: magenta→orange
- `neon-mint`: teal→green
- `neon-grape`: indigo→violet
- `neon-ember`: red→amber
Each = a CSS `background` value (gradient). Stored as `preset:<key>`.

## Resolution + rendering

- The message pane (`SlackMessagePane` / message list scroll area) gets the wallpaper as its background:
  - `preset:<key>` → apply the gradient CSS.
  - `wallpaper:<path>` (or a dm-attachments path) → sign the URL and set as `background-image: url(...)`; `cover`, `center`.
  - null → current default bg.
- Keep messages readable over an image: add a subtle scrim/overlay (e.g. a semi-opaque layer in the theme's bg color) behind the message rows, or render rows on slightly translucent surfaces. Ensure dark/light both readable.
- The composer + header keep their solid backgrounds (Slack/Telegram keep chrome solid); only the message scroll area shows the wallpaper.

## UI

- A "Set wallpaper" action: in the ChannelHeader details/kebab OR a small button. Opens a `WallpaperPicker` modal: a grid of neon presets (click to apply), an "Upload image" button (file input → upload to dm-attachments under the conversation path, then set `wallpaper`), and a "Remove wallpaper" option (set null). Show who set it / when if attribution included.
- Permission: any participant can change it (shared). Externals: allow if they're participants (or restrict to internal — decide; default allow participants, matching the shared intent). 
- Upload guards: reuse `src/lib/uploadGuards.js` (block SVG), size cap (e.g. 5 MB), image types only.

## Hook

`useConversationWallpaper(conversationId)` (or fold into useConversation): returns `{ wallpaper, setWallpaper(presetOrPath), uploadWallpaper(file), removeWallpaper, resolvedBackground }` and subscribes to conversations UPDATE for live propagation. Writes update the `conversations.wallpaper` (+ set_by/at). 

## Tests

- Pure helper `resolveWallpaper(value, signedUrl)` → CSS background string for preset/image/null; unit test.
- Preset constants test.

## Out of scope / cautions

- Don't break existing conversation UPDATE flows (title sync trigger migration 067, group rename). The new column is additive.
- Verify no RLS recursion (conversations ↔ conversation_participants).
- Migration must follow repo conventions (search_path hardening on any new SECURITY DEFINER fn, per migration 051).
