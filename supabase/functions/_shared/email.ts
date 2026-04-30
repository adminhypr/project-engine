// supabase/functions/_shared/email.ts
//
// Shared Resend email sender with retry + 4xx/5xx classification.
// Replaces the per-function copies of `sendEmail` that silently swallowed
// failures and never retried (audit task 3.5).
//
// Behavior:
//   - 3 attempts max, quadratic backoff (250 * attempt^2 ms between tries).
//   - 2xx              → { ok: true, id }
//   - 4xx (not 429)    → { ok: false, retryable: false, ... }   (permanent)
//   - 429 / 5xx / net  → retry; if all attempts fail, return retryable: true
//   - missing config   → { ok: false, retryable: false, status: 0, ... }
//
// Callers decide what to do on each outcome (mark dead-lettered, release
// queue claim for next tick, log + drop, etc.).
//
// Permanent-failure persistence (audit task 3.5 follow-up): when callers
// pass `opts.source`, the helper writes a row to `notify_failures`
// (migration 089) on permanent failure (4xx-not-429). Retryable / network-
// exhausted failures are NOT logged — they're already retried internally
// and the caller's release-claim path picks them up next tick. Logging
// requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars (always set
// in edge function runtime).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; retryable: boolean; status: number; error: string }

export interface SendEmailOptions {
  /** Optional CC recipients. Single string or array. Empty/absent → omitted. */
  cc?: string | string[]
  /** Override the From address for this call. Defaults to env-derived value. */
  from?: string
  /**
   * Source tag for notify_failures logging. When set, permanent failures
   * write a row to public.notify_failures (admin-readable). Common values:
   * 'notify' | 'send-alerts' | 'dm-offline-notify' | 'notification-digest'
   * | 'hub-mention-notify'. Omit to disable logging.
   */
  source?: string
  /**
   * Optional jsonb context attached to the notify_failures row. Use for
   * function-specific identifiers like { task_id, conversation_id,
   * recurrence_id }. Ignored when source is omitted.
   */
  context?: Record<string, unknown>
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

// Lazy admin client for notify_failures inserts. Created on first failure
// log so functions that never see a permanent failure don't pay the cost.
let _adminClient: ReturnType<typeof createClient> | null = null
function getAdminClient() {
  if (_adminClient) return _adminClient
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return null
  _adminClient = createClient(url, key)
  return _adminClient
}

async function logPermanentFailure(
  source: string,
  recipients: string[] | undefined,
  subject: string,
  status: number,
  error: string,
  context: Record<string, unknown> | undefined,
) {
  const client = getAdminClient()
  if (!client) {
    console.warn('logPermanentFailure: no admin client (SUPABASE_URL/SERVICE_ROLE_KEY missing)')
    return
  }
  // Best-effort recipient capture: only persist if we have exactly one
  // (multi-recipient rows blur which address actually bounced).
  const recipient_email = recipients && recipients.length === 1 ? recipients[0] : null
  const { error: insErr } = await client.from('notify_failures').insert({
    source,
    recipient_email,
    subject,
    http_status: status,
    retryable: false,
    error_message: error,
    context: context ?? null,
  })
  if (insErr) {
    // Don't block the caller's path on a logging failure — just warn.
    console.warn(`logPermanentFailure: insert failed: ${insErr.message}`)
  }
}
// FROM_EMAIL preference order matches the patterns already used by the
// individual edge functions (DM_FROM_EMAIL → ALERT_FROM_EMAIL → fallback).
const FROM_EMAIL =
  Deno.env.get('FROM_EMAIL') ??
  Deno.env.get('ALERT_FROM_EMAIL') ??
  Deno.env.get('DM_FROM_EMAIL') ??
  'alerts@hyprassistants.com'
const DEFAULT_FROM = `Hypr Task <${FROM_EMAIL}>`

function toArray(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined) return undefined
  const arr = Array.isArray(v) ? v : [v]
  return arr.length > 0 ? arr : undefined
}

/**
 * Send a transactional email via Resend with retry + classification.
 *
 * @param to       Single recipient or array of recipients.
 * @param subject  Email subject line.
 * @param html     Rendered HTML body.
 * @param opts     Optional CC list / From override.
 */
export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  opts: SendEmailOptions = {}
): Promise<SendResult> {
  if (!RESEND_API_KEY) {
    console.error('sendEmail: RESEND_API_KEY not configured')
    if (opts.source) {
      await logPermanentFailure(opts.source, undefined, subject, 0, 'RESEND_API_KEY not configured', opts.context)
    }
    return { ok: false, retryable: false, status: 0, error: 'RESEND_API_KEY not configured' }
  }

  const recipients = toArray(to)
  if (!recipients) {
    if (opts.source) {
      await logPermanentFailure(opts.source, undefined, subject, 0, 'no recipients', opts.context)
    }
    return { ok: false, retryable: false, status: 0, error: 'no recipients' }
  }

  const body: Record<string, unknown> = {
    from: opts.from ?? DEFAULT_FROM,
    to: recipients,
    subject,
    html,
  }
  const cc = toArray(opts.cc)
  if (cc) body.cc = cc

  const payload = JSON.stringify(body)

  for (let attempt = 1; attempt <= 3; attempt++) {
    let resp: Response
    try {
      resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      })
    } catch (err) {
      // Network / DNS / abort. Treat as retryable.
      console.warn(`sendEmail: network error (attempt ${attempt}):`, err)
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 250 * attempt * attempt))
        continue
      }
      return { ok: false, retryable: true, status: 0, error: `network: ${String(err)}` }
    }

    if (resp.ok) {
      let id = ''
      try {
        const data = await resp.json()
        id = typeof data?.id === 'string' ? data.id : ''
      } catch {
        // Resend always returns JSON on success, but be defensive.
      }
      return { ok: true, id }
    }

    const status = resp.status
    let text = ''
    try {
      text = await resp.text()
    } catch {
      text = `<unreadable body status=${status}>`
    }

    // 4xx (except 429) — permanent. Don't retry.
    if (status >= 400 && status < 500 && status !== 429) {
      console.error(`sendEmail: permanent ${status}: ${text}`)
      if (opts.source) {
        await logPermanentFailure(opts.source, recipients, subject, status, text, opts.context)
      }
      return { ok: false, retryable: false, status, error: text }
    }

    // 429 / 5xx — back off and retry.
    console.warn(`sendEmail: transient ${status} (attempt ${attempt}): ${text}`)
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, 250 * attempt * attempt))
    }
  }

  return { ok: false, retryable: true, status: 0, error: 'exhausted retries' }
}
