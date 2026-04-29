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

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; retryable: boolean; status: number; error: string }

export interface SendEmailOptions {
  /** Optional CC recipients. Single string or array. Empty/absent → omitted. */
  cc?: string | string[]
  /** Override the From address for this call. Defaults to env-derived value. */
  from?: string
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
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
    return { ok: false, retryable: false, status: 0, error: 'RESEND_API_KEY not configured' }
  }

  const recipients = toArray(to)
  if (!recipients) {
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
