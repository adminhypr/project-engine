# Heavier Composer Tools — Audio/Video Clips + Slash Commands (Design)

**Date:** 2026-06-19 · Branch `composer-media-tools` · Builds on the merged chat redesign.

Two independent features that round out the Slack-style composer:
1. **Audio & video clips** — record a voice/video message in the composer and send it inline (Slack's mic / camera-clip buttons).
2. **Slash commands** — type `/` to open a command menu (`/giphy`, `/shrug`, `/status`, …).

Both are **frontend-only — NO DB/migration changes.** Clips reuse the existing `attachments` JSONB column + `dm-attachments` bucket + the file-preview infra already built (`fileKind`, `AudioPlayer`, `FilePreview`). Slash commands are pure client logic.

---

## Part 1 — Audio & Video Clips

### What exists to reuse
- `src/lib/fileKind.js` — already classifies `audio` (mp3/m4a/wav/ogg/opus/weba…). **Add a `video` kind.**
- `src/components/chat/AudioPlayer.jsx` — inline audio player (play/scrub/duration/speed). Reused as-is for received audio clips.
- `src/components/chat/FilePreview.jsx` — branches by `fileKind`, signs URLs, renders audio inline. **Add a `video` branch → `VideoPlayer`.**
- `ChatComposer` upload path — already uploads `attachments` to `dm-attachments` at `{conversationId}/...` and sends them as `inline_images`/`attachments` JSONB entries. Reuse for clip upload.
- `src/lib/uploadGuards.js`, the 25 MB attachment cap (migration 105).

### Recording — MediaRecorder
- **Audio:** `navigator.mediaDevices.getUserMedia({ audio: true })` → `MediaRecorder` → collect `dataavailable` chunks → `Blob`. Preferred mime: `audio/webm;codecs=opus` (Chrome/Firefox/Edge), fallback `audio/mp4`/`audio/aac` (Safari — feature-detect via `MediaRecorder.isTypeSupported`).
- **Video:** `getUserMedia({ video: { width:1280 }, audio: true })` → `MediaRecorder` → `video/webm;codecs=vp9,opus` (or vp8), fallback `video/mp4` on Safari (Safari 14.1+ supports MediaRecorder; codec support varies — feature-detect).
- **Caveat (document + handle):** Safari's `MediaRecorder` mime support is narrower; always pick the first `isTypeSupported` candidate from a prioritized list, and if NONE supported, disable the clip button with a tooltip ("Recording isn't supported in this browser"). No client-side transcoding — we send whatever the browser records.

### Recording UX (a `ClipRecorder` component)
A popover/inline panel anchored above the composer, opened by a **mic** button (audio) or **camera** button (video):
1. **Permission** — request on open; if denied, show a clear message + how to re-enable. 
2. **Recording state** — a record/stop button, a live **timer** (mm:ss), audio: a simple level meter / animated waveform (optional, from the analyser node); video: a live `<video muted autoplay>` preview of the stream.
3. **Caps** — auto-stop at **5:00** (configurable); enforce the 25 MB attachment cap on the resulting blob (show error + let them re-record if exceeded).
4. **Review** — after stop, play back the recording (the `AudioPlayer`/`VideoPlayer`) with **Send / Re-record / Cancel**. (Slack sends immediately with a preview; we add a confirm step since recordings can be fumbled.)
5. **Send** — upload the blob to `dm-attachments` at `{conversationId}/clip/<uuid>.<ext>`, then send a message whose `attachments` array carries one entry:
   ```json
   {
     "storage_path": "<conversationId>/clip/<uuid>.webm",
     "name": "Audio clip.webm",        // or "Video clip.webm"
     "size": 123456,
     "type": "audio/webm",              // or "video/webm"
     "bucket": "dm-attachments",
     "source": "clip",
     "duration": 18.4                    // seconds (from the recorder), for the player label
   }
   ```
   `source`/`duration` are additive JSONB fields — no schema change.
6. **Cleanup** — always stop all `MediaStreamTrack`s on close/cancel/unmount (release mic/camera light).

### Receiving / playback
- **Audio clip** → existing `AudioPlayer` (it already handles `audio/*` attachments; pass `duration` for an instant label before metadata loads).
- **Video clip** → new `src/components/chat/VideoPlayer.jsx`: a `<video controls playsInline>` capped to the message column (~420px), rounded, with a poster/first-frame if cheap, lazy (`preload="metadata"`). Click → fullscreen/modal optional.
- `fileKind` gains `video` (mime `video/*` or ext mp4/webm/mov/m4v); `FilePreview` routes `video` → `VideoPlayer`. Both `/chat` and the widget inherit it (shared renderer).

### Files (Part 1)
- New: `ClipRecorder.jsx` (recording UI, shared by audio+video via a `mode` prop), `VideoPlayer.jsx`, `src/lib/mediaRecording.js` (pure-ish helpers: pick supported mime, format duration, size-check; the MediaRecorder wiring can live in a `useMediaRecorder` hook `src/hooks/useMediaRecorder.js`).
- Modify: `ChatComposer.jsx` (mic + camera buttons in the action row, gated by `MediaRecorder` support; single-popover coordination with emoji/GIF pickers), `fileKind.js` (+video), `FilePreview.jsx` (+video branch).
- Tests: `mediaRecording.test.js` (mime-pick fallback order, duration format, size-cap), `fileKind.test.js` (+video cases).

### Deferred (Part 1)
- **Transcripts** ("View transcript") — needs server-side speech-to-text (Whisper/Deepgram). Separate feature.
- **Poster/thumbnail generation** for video — can add later (draw first frame to canvas on upload).
- **Safari mp4 parity** — ship audio first (broadest support); video where supported, with graceful disable elsewhere.

---

## Part 2 — Slash Commands

### Trigger + menu (mirrors @-mentions)
- When the composer value starts with `/` (at message start), show a `SlashCommandMenu` popover (same pattern as `MentionPopover`): filtered list, ↑/↓ to navigate, Enter/Tab to run/complete, Esc to close.
- Parsing helper `src/lib/slashCommands.js`: `parseSlashCommand(text)` → `{ name, args }` or null; a `COMMANDS` registry `[{ name, description, argHint, run(args, ctx) }]`; `filterCommands(query)`.

### Command registry (pure-frontend; no server commands)
| Command | Action |
|---|---|
| `/giphy <query>` | Open the GIF picker pre-seeded with `<query>` (reuse `GifPicker`). |
| `/shrug` | Append `¯\_(ツ)_/¯` to the message text (don't send). |
| `/me <text>` | Send as an italicized "action" line (`_… text_`). |
| `/status <active\|away\|offline>` | Set manual presence via `presenceStatus.js`. |
| `/wallpaper` | Open the wallpaper picker (reuse `WallpaperPicker`). |
| `/gif`, `/emoji` | Open the GIF / emoji picker. |
| `/shortcuts` | Show the keyboard-shortcut cheat sheet (if/when added). |

`ctx` gives commands access to: composer setters (insert text / clear), `openGifPicker(query)`, `openEmojiPicker()`, `openWallpaper()`, `setPresence(status)`, `conversationId`, `sendMessage`. Commands either **transform the input** (shrug/me) or **invoke a UI action** (giphy/wallpaper/status) — most don't send a network request, so no DB/server.

### Files (Part 2)
- New: `src/lib/slashCommands.js` (registry + parser + filter, pure → unit-tested), `src/components/chat/SlashCommandMenu.jsx` (popover, mirrors `MentionPopover`).
- Modify: `ChatComposer.jsx` (detect leading `/`, render menu, run command on select; thread the `ctx` actions — some already exist: GIF picker, emoji picker, wallpaper, presence).
- Tests: `slashCommands.test.js` (parse, filter, each command's pure transform; UI-invoking commands tested at the registry level).

### Deferred (Part 2)
- **Server-backed commands** (`/remind`, `/invite`, integrations) — need backend; out of scope.
- Custom user-defined commands.

---

## Phasing (suggested order)
1. **Slash commands** (lower risk, pure logic + reuses existing pickers) — registry + menu + wire `/shrug`, `/giphy`, `/status`, `/wallpaper`, `/emoji`.
2. **Audio clips** (broad browser support) — `useMediaRecorder`, `ClipRecorder` (audio mode), upload, reuse `AudioPlayer`.
3. **Video clips** — `ClipRecorder` (video mode) + `VideoPlayer` + `fileKind`/`FilePreview` video branch; graceful disable where unsupported.

Each phase ships independently; all behind capability checks so unsupported browsers simply hide the affected button. Per-phase code review + the established test discipline (pure helpers unit-tested, UI manually verified).

## Constraints / invariants
- No DB, RLS, edge-function, or migration changes. Clips ride the existing `attachments` JSONB + `dm-attachments` bucket (RLS already scopes by `{conversationId}` leading folder).
- Reuse: `AudioPlayer`, `FilePreview`, `fileKind`, `GifPicker`, `EmojiPicker`, `WallpaperPicker`, `presenceStatus`, the composer caret-restore + single-popover patterns.
- Always release `MediaStream` tracks; cap duration + size; feature-detect `MediaRecorder`/codecs and disable gracefully.
- The widget shares `ChatComposer` + the renderer, so it inherits both features.

---

## Review corrections (multi-agent audit, 2026-06-19) — READ BEFORE IMPLEMENTING

The audit verified the core thesis (clips ride existing `attachments` JSONB + `dm-attachments`; slash commands are client-only; NO-DB is genuinely achievable) and confirmed the `sendMessage`/`FilePreview`/`fileKind` reuse claims. Fix these before/while building:

**Corrections (factual):**
1. **`/wallpaper` and `/status` are NOT composer-reachable as written.** `ChatComposer` is also mounted in the floating widget, task chat, and thread panel — none of which have a `WallpaperPicker` or `useConversationWallpaper`. `WallpaperPicker` lives at `src/components/chat/slack/WallpaperPicker.jsx` with props `{isOpen, onClose, wallpaper, busy, onSetPreset, onUploadImage, onRemove}` (NOT `{open,onClose,onPick}`) and is owned only by `SlackMessagePane` (/chat). Presence is `presenceStatus.setStatus(profileId, value)` driven from the rail/page, not the composer. → Either thread new props to every ChatComposer mount, or **scope `/wallpaper` and `/status` to /chat only (hide/no-op elsewhere). Recommend dropping them from phase 1.**
2. **GifPicker can't be pre-seeded.** `query` is internal state reset to `''` on open. `/giphy <query>` needs a new `initialQuery` prop on `GifPicker` — not pure reuse.
3. **Exact picker prop names:** `EmojiPicker` uses `onPick`, `GifPicker` uses `onSelect`. The `ctx.openEmojiPicker()/openGifPicker(query)` wrappers must map to these.
4. **`audio/aac` is not a valid MediaRecorder container** — Safari records audio as `audio/mp4` (AAC-in-MP4). Use `audio/mp4` as the Safari fallback candidate, not `audio/aac`.
5. **Safari video claim too optimistic.** Soften "Safari 14.1+" to "recent Safari/iOS, best-effort, feature-detected via `isTypeSupported`" — codec/version support is inconsistent.

**Gaps to add:**
6. **Recorder accessibility:** `role="status"`/`aria-live` for recording-state, the running timer, and auto-stop (composer already uses `role="status"` for upload progress).
7. **Clip optimistic-send / failure UX:** define what the message bubble shows while uploading and on failure (mirror the image "Uploading n of m" pattern).
8. **Duration is unreliable from the blob:** webm `MediaRecorder` blobs frequently report `duration: Infinity` until a seek hack. **Track elapsed seconds during recording** (don't read it off the blob) and store that as `duration`.
9. **`fileKind` SVG ordering:** keep `image/svg+xml` out of any inline `<video>`/`<img>` path when adding the `video` branch; fall back to a download card when the browser can't play the source (avoid a broken `<video>`).
10. **Slash UX:** spec sending a literal `/`-leading message, and unknown-command behavior (send as text vs. error). Trigger only when `/` is at message start.
11. **Test the high-risk paths:** `useMediaRecorder` track-cleanup + unsupported-browser disable (mock `MediaRecorder.isTypeSupported`).
12. **Mobile/iOS:** getUserMedia needs a user gesture + secure context; iOS inline `<video>` needs `playsInline`; recording support is limited — capability-gate and degrade.
13. **Video size vs duration:** 1280p+audio blows the 25 MB cap well before 5:00 — use a **60–90s default video cap, 720p + a `videoBitsPerSecond` constraint, and a running size estimate that auto-stops near ~22 MB.**

**Re-scoped sequencing (recommended):**
- **Phase 1 (slash) = composer-local only:** `/shrug`, `/me` (pure text transforms via `onSend`), `/emoji`, `/gif` (extend the existing `openPopover` union; defer the `/giphy <query>` seed or add the `initialQuery` prop). **Defer `/wallpaper` and `/status`** (need plumbing / are /chat-only).
- **Phase 2 = audio clips** (broad support, reuses `AudioPlayer`).
- **Phase 3 = video clips** (lower res/bitrate + shorter cap; graceful disable on unsupported browsers).
