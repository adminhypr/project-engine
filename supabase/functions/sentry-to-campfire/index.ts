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

interface Enrichment {
  userLabel: string | null    // resolved profile full_name (or email fallback)
  pagePath: string | null     // request.url → pathname only
  browser: string | null      // tag: browser
  os: string | null           // tag: os
  release: string | null      // tag: release
  envFromTags: string | null  // tag: environment (fallback when issue payload lacks it)
  userCount: number | null    // issue.userCount (total users affected)
  totalCount: number | null   // issue.count (total occurrences in Sentry)
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
  enrichment: Enrichment | null
}): string {
  const { level, environment, title, culprit, permalink, count, firstSeenAt, action, enrichment } = args
  const prefix = ACTION_PREFIX[action] ?? ''
  const icon = prefix ? '' : `${iconFor(level)} `
  const env  = environment !== 'unknown'
    ? `[${environment}] `
    : enrichment?.envFromTags ? `[${enrichment.envFromTags}] ` : ''
  const header = `${icon}${prefix}${env}${title}`
  const where  = culprit ? `\nin ${culprit}` : ''

  // Enrichment line: only render if we have at least one piece of info.
  const enrichBits: string[] = []
  if (enrichment?.userLabel) enrichBits.push(`👤 ${enrichment.userLabel}`)
  if (enrichment?.pagePath)  enrichBits.push(`🌐 ${enrichment.pagePath}`)
  if (enrichment?.browser)   enrichBits.push(`🖥️ ${enrichment.browser}`)
  const enrichLine = enrichBits.length ? `\n${enrichBits.join(' · ')}` : ''

  // Stats line — aggregates from Sentry's issue payload.
  const statsBits: string[] = []
  if (enrichment?.totalCount && enrichment.totalCount > 1) {
    statsBits.push(`${enrichment.totalCount}× total`)
  }
  if (enrichment?.userCount && enrichment.userCount > 1) {
    statsBits.push(`${enrichment.userCount} users`)
  }
  if (enrichment?.release) statsBits.push(`release ${enrichment.release}`)
  const statsLine = statsBits.length ? `\n${statsBits.join(' · ')}` : ''

  const seen   = count > 1
    ? `\n\nSeen ${count}× since ${formatTime(firstSeenAt)} (this 15-min window)`
    : ''
  const link   = permalink ? ` — [view in Sentry ↗](${permalink})` : ''
  return `${header}${where}${enrichLine}${statsLine}${seen}${link}`
}

// ── Enrichment via Sentry API ─────────────────────────────────
// The issue webhook only carries issue-level data. To show the user
// who triggered it and the page URL, we fetch the latest event for the
// issue via Sentry's REST API. Token comes from the same Internal
// Integration that posts the webhook.
//
// Failure mode: any error here returns null and the message posts with
// what we have from the webhook. Never blocks the campfire post.

async function fetchEnrichment(
  issueId: string,
  issuePayload: any,
): Promise<Enrichment | null> {
  const token = Deno.env.get('SENTRY_API_TOKEN')
  if (!token) return baseEnrichmentFromPayload(issuePayload)

  let event: any = null
  try {
    const res = await fetch(
      `https://sentry.io/api/0/issues/${issueId}/events/latest/`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      },
    )
    if (!res.ok) {
      console.warn(`[sentry-to-campfire] events/latest ${res.status}`)
      return baseEnrichmentFromPayload(issuePayload)
    }
    event = await res.json()
  } catch (err) {
    console.warn('[sentry-to-campfire] events/latest fetch failed:', err)
    return baseEnrichmentFromPayload(issuePayload)
  }

  // Sentry tags come in either [["k","v"], ...] or [{key,value}, ...] form.
  const tagMap: Record<string, string> = {}
  for (const t of event?.tags ?? []) {
    if (Array.isArray(t)) tagMap[t[0]] = t[1]
    else if (t?.key) tagMap[t.key] = t.value
  }

  // user.id from the SDK is our profiles.id (set in useAuth via
  // Sentry.setUser({id:profile.id})). Resolve to a name.
  let userLabel: string | null = null
  const sentryUserId = event?.user?.id ?? null
  if (sentryUserId) {
    const { data } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', sentryUserId)
      .maybeSingle()
    userLabel = data?.full_name || data?.email || `user ${sentryUserId.slice(0, 8)}`
  } else if (event?.user?.email) {
    userLabel = event.user.email
  } else if (event?.user?.username) {
    userLabel = event.user.username
  }

  // Trim request.url to pathname for readability. Skip query string.
  let pagePath: string | null = null
  const rawUrl = event?.request?.url ?? null
  if (rawUrl) {
    try {
      const u = new URL(rawUrl)
      pagePath = u.pathname || '/'
    } catch {
      pagePath = rawUrl
    }
  }

  const base = baseEnrichmentFromPayload(issuePayload)
  return {
    userLabel: userLabel ?? base?.userLabel ?? null,
    pagePath:  pagePath  ?? null,
    browser:   tagMap['browser'] ?? tagMap['browser.name'] ?? null,
    os:        tagMap['os'] ?? tagMap['os.name'] ?? null,
    release:   tagMap['release'] ?? null,
    envFromTags: tagMap['environment'] ?? null,
    userCount:  base?.userCount  ?? null,
    totalCount: base?.totalCount ?? null,
  }
}

// Without an API token we can still pull aggregate counts straight off
// the issue webhook payload (no per-event detail).
function baseEnrichmentFromPayload(issuePayload: any): Enrichment | null {
  const issue = issuePayload?.data?.issue
  if (!issue) return null
  return {
    userLabel: null,
    pagePath: null,
    browser: null,
    os: null,
    release: null,
    envFromTags: null,
    userCount:  toIntOrNull(issue.userCount),
    totalCount: toIntOrNull(issue.count),
  }
}

function toIntOrNull(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'string' ? parseInt(v, 10) : Number(v)
  return Number.isFinite(n) ? n : null
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
    // Don't refetch from Sentry on each dedup hit — the original message
    // already has the enrichment baked in. We just bump the counter line.
    // But we lose the enrichment lines on the rewritten message body
    // unless we either (a) store them, or (b) keep the original message
    // body and only append the counter. Simpler: refetch only when we
    // really want fresh detail. For now, keep it cheap and accept that
    // the enrichment shows only on the original post; subsequent dedup
    // hits write a shorter "Seen N× since X" body. The Sentry link still
    // gets you the full detail.
    const content = renderMessage({
      level: parsed.level,
      environment: parsed.environment,
      title: parsed.title,
      culprit: parsed.culprit,
      permalink: parsed.permalink,
      count: newCount,
      firstSeenAt: existing.first_seen_at,
      action: parsed.action,
      enrichment: null,
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
  // Enrich via Sentry API to pull user, page, browser. Failures here are
  // logged but don't block the campfire post.
  const enrichment = await fetchEnrichment(parsed.issueId, payload)
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
    enrichment,
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
