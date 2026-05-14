// supabase/functions/sentry-to-campfire/index.ts
//
// Bridges Sentry → Project Engine campfire chat. Sentry's Internal
// Integration posts here on every event; we collapse same-fingerprint
// bursts into one updated message inside a 15-minute window.
//
// Deploy:    npx supabase functions deploy sentry-to-campfire --no-verify-jwt
// Configure: npx supabase secrets set \
//              SENTRY_CLIENT_SECRET=<from Sentry Internal Integration> \
//              SENTRY_CAMPFIRE_CONVERSATION_ID=<errors campfire conv id>
//
// Sentry signs the request body with HMAC-SHA256 keyed by the client
// secret. We verify before any DB work. This is a separate scheme from
// the project's `WEBHOOK_SHARED_SECRET` (Sentry sends its own header
// `Sentry-Hook-Signature` and we can't inject custom ones).
//
// Message flow per request:
//   1. Verify signature (constant-time).
//   2. Parse payload, extract issue fingerprint + event metadata.
//   3. Look up sentry_alert_dedupe by issue_id.
//   4a. Within 15-min window → UPDATE existing dm_messages content
//       with bumped "Seen N×" counter.
//   4b. Otherwise → INSERT new dm_messages, UPSERT dedupe row.
//
// Failure handling:
//   • Signature mismatch → 401, no DB write.
//   • DB write fails → 500, Sentry's webhook subsystem retries.
//   • Payload missing required fields → 200 (no-op, log warning) so
//     Sentry doesn't retry forever on a malformed delivery.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SENTRY_BOT_ID = '00000000-0000-0000-0000-000000005e74'
const DEDUPE_WINDOW_MS = 15 * 60 * 1000

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// ── Signature verification ─────────────────────────────────────
// Sentry signs with HMAC-SHA256 over the raw body using the
// Internal Integration's Client Secret. Header is `Sentry-Hook-Signature`.
// Uses Deno's native Web Crypto rather than node:crypto compat — the
// compat shim has historically returned subtly different bytes here.

async function verifySentrySignature(rawBody: string, headerSig: string | null): Promise<boolean> {
  if (!headerSig) return false
  const secret = Deno.env.get('SENTRY_CLIENT_SECRET')
  if (!secret) {
    console.error('[sentry-to-campfire] SENTRY_CLIENT_SECRET not set — rejecting')
    return false
  }
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody))
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  if (expected.length !== headerSig.length) return false
  // Constant-time string compare over hex characters.
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ headerSig.charCodeAt(i)
  }
  return diff === 0
}

// ── Payload parsing ───────────────────────────────────────────
// Sentry has THREE webhook delivery paths with different payload shapes:
//   • Issue resource webhook  (free plan):  data.issue.{...}      action=created|resolved|assigned|ignored|unresolved
//   • Error resource webhook  (paid only):  data.error.{...}      action=created
//   • Alert Rule action       (legacy):     data.event.{...}      action=triggered
// We pull from all three. Whichever container yields an `issueId` wins.

interface ParsedEvent {
  issueId: string
  environment: string
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug' | 'unknown'
  title: string
  culprit: string
  permalink: string | null
  action: string
}

function parsePayload(payload: any): ParsedEvent | null {
  const container =
    payload?.data?.event ??
    payload?.data?.error ??
    payload?.data?.issue ??
    null
  if (!container) return null

  const issueId = String(
    container.issue_id ??
    container.issue?.id ??
    container.id ??
    payload?.data?.issue?.id ??
    ''
  )
  if (!issueId) return null

  // `environment` is only present on event/error payloads. Issue
  // resource webhooks don't carry it directly — try `project.slug`
  // as a fallback hint, else "unknown".
  const environment = String(
    container.environment ??
    payload?.data?.event?.environment ??
    'unknown'
  )

  const level = normalizeLevel(container.level)
  const title = String(
    container.title ??
    container.metadata?.value ??
    container.metadata?.title ??
    'Unknown error'
  )
  const culprit = String(container.culprit ?? container.transaction ?? '')

  const permalink =
    container.web_url ??
    container.url ??
    container.issue_url ??
    container.permalink ??
    payload?.data?.issue?.web_url ??
    null

  // Pass action verb through so the message can say "resolved" vs
  // "created" — useful with the issue webhook which fires on lifecycle.
  const action = String(payload?.action ?? 'created')

  return { issueId, environment, level, title, culprit, permalink, action }
}

function normalizeLevel(raw: unknown): ParsedEvent['level'] {
  const s = typeof raw === 'string' ? raw.toLowerCase() : ''
  if (s === 'fatal' || s === 'error' || s === 'warning' || s === 'info' || s === 'debug') {
    return s
  }
  return 'unknown'
}

// ── Message rendering ─────────────────────────────────────────
// Markdown — the campfire renderer handles it. Format:
//   🔴 [prod] TypeError: Cannot read property…
//   in src/hooks/useTasks.jsx:142
//
//   Seen 4× since 14:32 — [view in Sentry ↗](https://…)

function iconFor(level: ParsedEvent['level']): string {
  if (level === 'fatal' || level === 'error') return '🔴'
  if (level === 'warning') return '🟠'
  if (level === 'info' || level === 'debug') return '🔵'
  return '⚪'
}

function formatTime(iso: string): string {
  // HH:MM in UTC. The user is single-timezone-ish (US) — fine for now.
  // If multi-tz becomes a thing we can pass a tz env var.
  const d = new Date(iso)
  const hh = String(d.getUTCHours()).padStart(2, '0')
  const mm = String(d.getUTCMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

// Friendly verb for the issue-resource webhook actions. Lifecycle
// events get a short prefix so the campfire reads naturally.
const ACTION_PREFIX: Record<string, string> = {
  created:    '',           // default — no prefix
  resolved:   '✅ resolved: ',
  unresolved: '⚠️ reopened: ',
  assigned:   '👤 assigned: ',
  ignored:    '🔇 ignored: ',
  archived:   '📦 archived: ',
}

function renderMessage(args: {
  level: ParsedEvent['level']
  environment: string
  title: string
  culprit: string
  permalink: string | null
  count: number
  firstSeenAt: string
  action: string
}): string {
  const { level, environment, title, culprit, permalink, count, firstSeenAt, action } = args
  const prefix = ACTION_PREFIX[action] ?? ''
  const icon = prefix ? '' : `${iconFor(level)} `  // skip icon if prefix already conveys meaning
  const env  = environment !== 'unknown' ? `[${environment}] ` : ''
  const header = `${icon}${prefix}${env}${title}`
  const where  = culprit ? `\nin ${culprit}` : ''
  const seen   = count > 1
    ? `\n\nSeen ${count}× since ${formatTime(firstSeenAt)}`
    : ''
  const link   = permalink ? ` — [view in Sentry ↗](${permalink})` : ''
  return `${header}${where}${seen}${link}`
}

// ── HTTP handler ──────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405 })
  }

  const rawBody = await req.text()
  const sig = req.headers.get('sentry-hook-signature')
  if (!(await verifySentrySignature(rawBody, sig))) {
    return new Response(JSON.stringify({ error: 'invalid_signature' }), { status: 401 })
  }

  const convId = Deno.env.get('SENTRY_CAMPFIRE_CONVERSATION_ID')
  if (!convId) {
    console.error('[sentry-to-campfire] SENTRY_CAMPFIRE_CONVERSATION_ID not set')
    return new Response(JSON.stringify({ error: 'not_configured' }), { status: 500 })
  }

  let payload: any
  try { payload = JSON.parse(rawBody) }
  catch { return new Response(JSON.stringify({ error: 'bad_json' }), { status: 400 }) }

  const parsed = parsePayload(payload)
  if (!parsed) {
    console.warn('[sentry-to-campfire] payload missing required fields — skipping')
    return new Response(JSON.stringify({ action: 'skipped_malformed' }), { status: 200 })
  }

  // Look up existing dedupe row.
  const { data: existing, error: lookupErr } = await supabase
    .from('sentry_alert_dedupe')
    .select('issue_id, last_message_id, event_count, first_seen_at, last_seen_at')
    .eq('issue_id', parsed.issueId)
    .maybeSingle()

  if (lookupErr) {
    console.error('[sentry-to-campfire] dedupe lookup failed:', lookupErr)
    return new Response(JSON.stringify({ error: 'lookup_failed' }), { status: 500 })
  }

  const now = Date.now()
  // Only fold `created` actions into the existing dedupe row. Lifecycle
  // actions (resolved/assigned/unresolved/...) are rare and meaningful —
  // they always post fresh so they don't get hidden inside a "Seen N×".
  const inWindow = existing
    && parsed.action === 'created'
    && (now - new Date(existing.last_seen_at).getTime()) < DEDUPE_WINDOW_MS

  if (inWindow) {
    const newCount = existing.event_count + 1
    const content = renderMessage({
      level: parsed.level,
      environment: parsed.environment,
      title: parsed.title,
      culprit: parsed.culprit,
      permalink: parsed.permalink,
      count: newCount,
      firstSeenAt: existing.first_seen_at,
      action: parsed.action,
    })

    const { error: msgErr } = await supabase
      .from('dm_messages')
      .update({ content })
      .eq('id', existing.last_message_id)
    if (msgErr) {
      console.error('[sentry-to-campfire] message update failed:', msgErr)
      return new Response(JSON.stringify({ error: 'message_update_failed' }), { status: 500 })
    }

    const { error: dedupeErr } = await supabase
      .from('sentry_alert_dedupe')
      .update({ event_count: newCount, last_seen_at: new Date().toISOString() })
      .eq('issue_id', parsed.issueId)
    if (dedupeErr) {
      console.error('[sentry-to-campfire] dedupe update failed:', dedupeErr)
      return new Response(JSON.stringify({ error: 'dedupe_update_failed' }), { status: 500 })
    }

    return new Response(JSON.stringify({ action: 'updated', count: newCount }), { status: 200 })
  }

  // Fresh post — new fingerprint, window expired, or a non-'created' action.
  const firstSeen = new Date().toISOString()
  const content = renderMessage({
    level: parsed.level,
    environment: parsed.environment,
    title: parsed.title,
    culprit: parsed.culprit,
    permalink: parsed.permalink,
    count: 1,
    firstSeenAt: firstSeen,
    action: parsed.action,
  })

  const { data: inserted, error: insertErr } = await supabase
    .from('dm_messages')
    .insert({
      conversation_id: convId,
      author_id: SENTRY_BOT_ID,
      kind: 'system',
      content,
    })
    .select('id')
    .single()
  if (insertErr || !inserted) {
    console.error('[sentry-to-campfire] message insert failed:', insertErr)
    return new Response(JSON.stringify({ error: 'message_insert_failed' }), { status: 500 })
  }

  const { error: upsertErr } = await supabase
    .from('sentry_alert_dedupe')
    .upsert({
      issue_id: parsed.issueId,
      conversation_id: convId,
      last_message_id: inserted.id,
      environment: parsed.environment,
      level: parsed.level,
      first_seen_at: firstSeen,
      last_seen_at: firstSeen,
      event_count: 1,
    }, { onConflict: 'issue_id' })
  if (upsertErr) {
    console.error('[sentry-to-campfire] dedupe upsert failed:', upsertErr)
    // Message is already posted — don't 500 just because dedupe didn't
    // record. Worst case next event creates a duplicate message.
  }

  return new Response(JSON.stringify({ action: 'posted', message_id: inserted.id }), { status: 200 })
})
