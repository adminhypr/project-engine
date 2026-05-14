# Sentry → Campfire Error Notifications — Design

**Date:** 2026-05-14
**Status:** Design complete, ready to implement

## Goal

Surface production errors in-app via a dedicated hub campfire, so I see them in the same place I work instead of switching tools. Sentry remains the source of truth (history, breadcrumbs, search); the campfire is a fast-glance alert channel.

## Decisions

| | |
|---|---|
| Sentry org | `hypr-services.sentry.io` |
| Sentry project | `project-engine` (Browser → React platform) |
| DSN | `https://79ec3eb7bcd1ca21377864b41be4dc68@o4511066795474944.ingest.us.sentry.io/4511389006757888` |
| Destination hub | `4ad3925e-0535-4df1-acae-e2e532d7233c` (Systems Development) |
| New campfire module | "Errors" inside the destination hub |
| Trigger scope | Every event (dedup at our edge) |
| Dedup strategy | By issue fingerprint, 15-min window; in-window events update the existing message ("Seen N×") |
| Environments | All (prod, preview, dev) |
| Icon | By level — 🔴 error/fatal, 🟠 warning, 🔵 info |
| Poster | Dedicated bot profile `Sentry` (id `00000000-0000-0000-0000-000000005e74`) |

## Architecture

```
[Frontend error]      [Edge function error]
        │                       │
        └───────┬───────────────┘
                ▼
        ┌─────────────┐
        │   Sentry    │  ← source of truth
        └──────┬──────┘
               │ Internal Integration webhook (Issue Alert: every event)
               ▼
   ┌────────────────────────────┐
   │ Edge function:             │
   │   sentry-to-campfire       │
   │                            │
   │   1. verifySentrySignature │
   │   2. lookup dedupe row     │
   │   3a. new OR window over:  │
   │       INSERT dm_message    │
   │       UPSERT dedupe row    │
   │   3b. within 15 min:       │
   │       UPDATE same message  │
   │       (count++, last_seen) │
   └───────┬────────────────────┘
           ▼
   conversations (kind='hub') ──▶ existing realtime + outbox
                                  → bell + offline email per existing flow
```

### Why these choices

- **One new edge function** mirrors `notify` / `hub-mention-notify` (webhook-driven pattern).
- **Separate signature scheme** from `WEBHOOK_SHARED_SECRET` because Sentry signs requests its own way (HMAC-SHA256 over body, `Sentry-Hook-Signature` header). Cannot inject our own header.
- **One new table** (`sentry_alert_dedupe`) keyed by Sentry issue id. Tiny, prunable, service-role-only.
- **Reuses existing campfire stack** — message is just an `INSERT INTO dm_messages` against the new campfire's conversation. No new realtime, no new UI work. Hub members get bell + email via existing `notification_outbox` flow (mig 062).

## Schema (migration 104)

```sql
-- Bot profile (seeded once, idempotent)
insert into profiles (id, email, full_name, role)
values (
  '00000000-0000-0000-0000-000000005e74',
  'sentry-bot@hyprassistants.com',
  'Sentry',
  'Staff'
)
on conflict (id) do nothing;

-- Dedupe table
create table sentry_alert_dedupe (
  issue_id          text primary key,
  conversation_id   uuid not null references conversations(id) on delete cascade,
  last_message_id   uuid not null references dm_messages(id) on delete cascade,
  environment       text not null,
  level             text not null,
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  event_count       integer not null default 1
);

create index sentry_alert_dedupe_last_seen_idx
  on sentry_alert_dedupe (last_seen_at);

alter table sentry_alert_dedupe enable row level security;
-- No policies — service role only.

-- Retention: 30d, nightly (matches mig 082 pattern)
create or replace function prune_sentry_alert_dedupe()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  with deleted as (
    delete from sentry_alert_dedupe
    where last_seen_at < now() - interval '30 days'
    returning 1
  ) select count(*)::int into v_count from deleted;
  return v_count;
end $$;

select cron.schedule(
  'prune-sentry-dedupe-nightly',
  '20 3 * * *',
  $$select prune_sentry_alert_dedupe();$$
);
```

## Edge function (`supabase/functions/sentry-to-campfire/index.ts`)

**Inputs:**
- HTTP POST from Sentry Internal Integration
- Header `Sentry-Hook-Signature` (HMAC-SHA256 hex)
- Body: Sentry issue alert payload

**Env vars:**
- `SENTRY_CLIENT_SECRET` — from Sentry Internal Integration setup
- `SENTRY_CAMPFIRE_CONVERSATION_ID` — captured post-Phase-5 setup
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — standard

**Flow:**
1. Verify Sentry signature (constant-time compare). On mismatch → 401.
2. Parse payload. Extract `issue.id`, `event.environment`, `event.level`, `event.title`, `event.culprit`, `issue.web_url`.
3. Lookup `sentry_alert_dedupe` by `issue_id`.
4. If row exists AND `now() - last_seen_at < 15 min`:
   - `event_count + 1`
   - UPDATE `dm_messages` content with new count
   - UPDATE `sentry_alert_dedupe` `(event_count, last_seen_at)`
5. Else (new fingerprint OR window expired):
   - INSERT `dm_messages` (sender = bot, conversation = errors campfire, content = rendered)
   - UPSERT `sentry_alert_dedupe` (resets count to 1, refreshes timestamps)
6. Return 200.

**Message format:**

```
🔴 [prod] TypeError: Cannot read properties of undefined (reading 'id')
in src/hooks/useTasks.jsx:142

Seen 4× since 14:32 — [view in Sentry ↗](https://hypr-services.sentry.io/issues/12345/)
```

Icon by level: 🔴 error/fatal, 🟠 warning, 🔵 info. Environment in brackets so dev noise is obvious.

**Failure handling:**
- Signature mismatch → 401, no DB write.
- DB write fails → 500, Sentry's webhook subsystem retries.

## Frontend wiring

- Install `@sentry/react`, `@sentry/vite-plugin`.
- `src/main.jsx`: `Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, environment: import.meta.env.MODE, ... })`.
- Extend existing `ErrorBoundary` to use `Sentry.ErrorBoundary` (or wrap).
- In `useAuth`, call `Sentry.setUser({ id: profile.id })` once profile loads; `Sentry.setUser(null)` on logout.
- PII scrubbing in `beforeSend`: strip email-shaped strings from breadcrumbs and message bodies.
- Source map upload via `@sentry/vite-plugin` (gated on `SENTRY_AUTH_TOKEN` so local builds don't fail).

## Manual deploy steps (user-side, post-merge)

See checklist in chat (Phase 5–8). Summary:

1. `supabase db push` → migration 104.
2. `supabase functions deploy sentry-to-campfire --no-verify-jwt`.
3. Create "Errors" campfire module in the Systems Development hub via SQL; capture conversation id.
4. Add bot to `hub_members` of that hub.
5. Upload robot avatar to bot profile.
6. Create Sentry Internal Integration → webhook URL → copy client secret.
7. Create Sentry Issue Alert rule (every event → webhook).
8. Set `supabase secrets`: `SENTRY_CLIENT_SECRET`, `SENTRY_CAMPFIRE_CONVERSATION_ID`.
9. Set Vercel env: `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`.
10. Smoke test: `throw new Error("smoke")` in browser console; verify message appears.

## YAGNI / out of scope

- No new UI — campfire renders normally.
- No mute/snooze per fingerprint (Sentry already has this).
- No severity-based routing (one channel, all levels).
- No retroactive backfill of existing Sentry issues.
- No bot profile presence suppression — bot appears online/offline like a normal member. Acceptable.

## Risks

- **"Every event" + "all environments" = potential spam.** Dedup at 15 min mitigates same-fingerprint floods but distinct errors still each get a message. If dev noise becomes a problem, change the Sentry alert rule to "prod only" or to "new issues only" — no code change needed.
- **Sentry free tier is 5k events/month.** All-environments capture could blow through it. Monitor in first week.
- **Bot profile in hub member list** is a minor cosmetic quirk. Worth it for clean attribution.
