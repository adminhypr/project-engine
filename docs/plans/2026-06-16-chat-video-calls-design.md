# Chat video calls (Google Meet) — design + runbook

**Date:** 2026-06-16
**Branch:** `feat/chat-meet-calls`
**Status:** Implemented; dark behind `VITE_CALLS_ENABLED` until Google setup is done

## Goal

A "start a call" button in chat that generates a Google Meet link and posts a
join card into the conversation. Anyone in the conversation joins by clicking —
no per-user Google account required.

## How it works

```
User clicks 🎥 in the conversation header
   → supabase.functions.invoke('create-meet-link', { conversation_id })
       1. verifyJWT → caller identity
       2. service-role check: caller ∈ conversation_participants  (else 403)
       3. Google: refresh-token → access-token → POST meet/v2/spaces {accessType: OPEN}
       4. INSERT dm_messages { kind:'call', author_id: caller, content: "📞 … <url>" }
       5. return { url }
   → starter's browser opens the url; everyone else sees the call card via the
     existing dm realtime subscription.
```

- The call message is authored by the **real user** (not a bot), so unread
  counts, the bell, and the offline digest all work with no new code.
- `dm_messages.kind='call'` tells the renderer to draw a Join-call card. Old
  clients that don't know `'call'` render the body as a normal bubble with a
  clickable Meet link — graceful degradation.
- `accessType: OPEN` → externals / password users join by clicking, no knocking.

## Surfaces

The button lives in the shared `ConversationHeader`, so it appears wherever a
conversation opens via `ConversationPane`: widget DMs/groups/task chats **and**
the `/chat` page (DMs, groups, and campfires opened there). The in-hub-module
`Campfire.jsx` compact view has no header and is out of scope for v1; a call
message landing there still renders as a clickable link.

## What was built

- **Migration 106** — additive: widen `dm_messages.kind` CHECK to allow
  `'call'`. No tables/RLS/triggers touched. Reversible.
- **Edge function `create-meet-link`** — participant check + Meet space mint +
  call-message insert. Returns `{ url }`, or `{ error: 'not_configured' }`
  (200) when the Google secrets are absent (feature stays dark).
- **Frontend**:
  - `ConversationHeader` — 🎥 button (gated on an `onStartCall` prop).
  - `ConversationPane` — `startCall()` (invoke → `window.open`), gated behind
    `import.meta.env.VITE_CALLS_ENABLED === 'true'`.
  - `DmChatMessage` — `kind='call'` → Join-call card.
  - `lib/meetLink.js` (+5 tests) — build/extract the Meet URL, `isCallMessage`.

## Safety

- **One additive migration**, nothing else on the DB.
- Existing chat paths untouched — calls reuse `dm_messages` + the realtime +
  notification stack as-is.
- **Ships dark**: no button until `VITE_CALLS_ENABLED=true` AND the Google
  secrets exist (otherwise the function returns `not_configured` and the button
  toasts a friendly message). So merging this changes nothing visible in prod
  until you deliberately enable it.

## Deploy order (each step inert without the next)

1. Apply **migration 106** to prod (additive; safe anytime).
2. Do the **Google Cloud setup** (below) and `supabase secrets set` the three
   `GOOGLE_MEET_*` values.
3. `npx supabase functions deploy create-meet-link`.
4. Set `VITE_CALLS_ENABLED=true` in Vercel env and redeploy the frontend.

## Google Cloud setup runbook (Workspace admin)

1. **Google Cloud Console** → the hyprassistants.com project → **APIs & Services
   → Enable APIs** → enable **Google Meet API**.
2. **OAuth consent screen** → User type **Internal** (no verification review).
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   Add an authorized redirect URI you can paste a code back from (e.g.
   `https://developers.google.com/oauthplayground` if you mint the token there).
   Save the **Client ID** + **Client secret**.
4. **Mint a refresh token** for a dedicated bot account (e.g.
   `meet-bot@hyprassistants.com`) with scope
   `https://www.googleapis.com/auth/meetings.space.created`, `access_type=offline`,
   `prompt=consent`. The OAuth Playground (gear → use your own client id/secret)
   is the quickest path. Copy the **refresh token**.
5. Set the function secrets:
   ```
   supabase secrets set \
     GOOGLE_MEET_CLIENT_ID=... \
     GOOGLE_MEET_CLIENT_SECRET=... \
     GOOGLE_MEET_REFRESH_TOKEN=...
   ```
6. Deploy the function and flip `VITE_CALLS_ENABLED=true`.

## Out of v1

- In-hub-module campfire compact view button.
- Ring/notify "call started" beyond the normal message notification.
- Call presence / "who's on the call" / auto-expiry of the card.
