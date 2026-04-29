// supabase/functions/notification-digest/index.ts
//
// Cron-driven (every 15 minutes). Sends ONE summary email per offline user
// covering all events queued in `notification_outbox` since their last digest.
//
// "Offline" = `profiles.last_seen_at < now() - interval '5 minutes'`.
// "Per user" = a single grouped email instead of N per-event blasts.
//
// Users with `email_digest_enabled = false` are skipped entirely (any
// queued rows are still kept; they just never get emailed).
//
// Idempotency: each row's `emailed_at` is set after a successful send.
// On retry, only un-emailed rows are picked up. If the email fails, rows
// stay unmarked and will retry on the next tick.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/security.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('ALERT_FROM_EMAIL') || 'alerts@hyprassistants.com'
const PUBLIC_APP_URL = Deno.env.get('PUBLIC_APP_URL') || 'https://tasks.hyprstaffing.com'
const OFFLINE_WINDOW_MINUTES = 5

interface OutboxRow {
  id: string
  recipient_id: string
  event_type: string
  payload: Record<string, any>
  source_table: string | null
  source_id: string | null
  created_at: string
}

interface RecipientProfile {
  id: string
  email: string | null
  full_name: string | null
  email_digest_enabled: boolean
  last_seen_at: string | null
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Hypr Task <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
    }),
  })
  return res.ok
}

// Render one section per event type group ("3 new task comments", "2 mentions", etc.).
function renderDigestHtml(rows: OutboxRow[], userName: string): { subject: string; html: string } {
  const byType: Record<string, OutboxRow[]> = {}
  for (const r of rows) {
    if (!byType[r.event_type]) byType[r.event_type] = []
    byType[r.event_type].push(r)
  }

  const sections: string[] = []
  let totalCount = rows.length

  function section(label: string, items: OutboxRow[], render: (r: OutboxRow) => string) {
    if (items.length === 0) return
    sections.push(`
      <div style="margin: 20px 0;">
        <h3 style="color:#1f2937; font-size:14px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.05em;">${escape(label)} (${items.length})</h3>
        <ul style="list-style: none; padding: 0; margin: 0;">
          ${items.slice(0, 10).map(r => `<li style="padding: 6px 0; border-bottom: 1px solid #e5e7eb; color:#374151; font-size: 14px;">${render(r)}</li>`).join('')}
          ${items.length > 10 ? `<li style="color:#6b7280; font-size: 13px; padding: 6px 0; font-style: italic;">+ ${items.length - 10} more…</li>` : ''}
        </ul>
      </div>
    `)
  }

  // Tasks
  section('Tasks assigned to you', byType['task_assigned'] || [], (r) =>
    `<strong>${escape(r.payload.task_title || 'Task')}</strong> — assigned by ${escape(r.payload.actor_name || 'Someone')}`
  )

  // Comments + comment mentions
  const commentItems = (byType['comment_mention'] || []).concat(byType['comment_posted'] || [])
  section('Task comments', commentItems, (r) => {
    const isMention = r.event_type === 'comment_mention'
    return `${isMention ? '<strong>@you</strong> ' : ''}${escape(r.payload.actor_name || 'Someone')} on <strong>${escape(r.payload.task_title || 'a task')}</strong>: <em style="color:#6b7280;">${escape(r.payload.snippet || '').slice(0, 100)}</em>`
  })

  // DMs
  section('Direct messages', byType['dm_message'] || [], (r) =>
    `<strong>${escape(r.payload.actor_name || 'Someone')}</strong>: <em style="color:#6b7280;">${escape(r.payload.snippet || '').slice(0, 100)}</em>`
  )

  // Group + task chat
  const chatMentions = (byType['group_mention'] || []).concat(byType['task_chat_mention'] || [])
  section('Mentions in chat', chatMentions, (r) => {
    const where = r.payload.conversation_kind === 'task'
      ? `task <strong>${escape(r.payload.task_title || 'a task')}</strong>`
      : r.payload.conversation_kind === 'hub'
        ? `hub <strong>${escape(r.payload.hub_name || r.payload.group_title || 'a hub')}</strong>`
        : `group <strong>${escape(r.payload.group_title || 'a group')}</strong>`
    return `<strong>${escape(r.payload.actor_name || 'Someone')}</strong> mentioned you in ${where}: <em style="color:#6b7280;">${escape(r.payload.snippet || '').slice(0, 100)}</em>`
  })

  const chatActivity = (byType['group_message'] || []).concat(byType['task_chat_message'] || [])
  section('Chat activity', chatActivity, (r) => {
    const where = r.payload.conversation_kind === 'task'
      ? `task <strong>${escape(r.payload.task_title || 'a task')}</strong>`
      : r.payload.conversation_kind === 'hub'
        ? `hub <strong>${escape(r.payload.hub_name || r.payload.group_title || 'a hub')}</strong>`
        : `group <strong>${escape(r.payload.group_title || 'a group')}</strong>`
    return `<strong>${escape(r.payload.actor_name || 'Someone')}</strong> in ${where}: <em style="color:#6b7280;">${escape(r.payload.snippet || '').slice(0, 100)}</em>`
  })

  // Hub mentions
  section('Hub mentions', byType['hub_mention'] || [], (r) =>
    `<strong>${escape(r.payload.actor_name || 'Someone')}</strong> mentioned you in <strong>${escape(r.payload.hub_name || 'a hub')}</strong>`
  )

  // Card Table — assignments
  section('Cards assigned to you', byType['card_assigned'] || [], (r) => {
    const link = r.payload.hub_id && r.payload.card_id
      ? `${PUBLIC_APP_URL}/hub/${escape(r.payload.hub_id)}?card=${escape(r.payload.card_id)}`
      : null
    const title = `<strong>${escape(r.payload.card_title || 'Card')}</strong>`
    const titleLinked = link ? `<a href="${link}" style="color:#4f46e5; text-decoration:none;">${title}</a>` : title
    const hub = r.payload.hub_name ? ` in <strong>${escape(r.payload.hub_name)}</strong>` : ''
    return `You were assigned to ${titleLinked}${hub} by ${escape(r.payload.actor_name || 'Someone')}`
  })

  // Card Table — comments + mentions
  const cardCommentItems = (byType['card_mention'] || []).concat(byType['card_comment'] || [])
  section('Card comments', cardCommentItems, (r) => {
    const isMention = r.event_type === 'card_mention'
    const link = r.payload.hub_id && r.payload.card_id
      ? `${PUBLIC_APP_URL}/hub/${escape(r.payload.hub_id)}?card=${escape(r.payload.card_id)}`
      : null
    const title = `<strong>${escape(r.payload.card_title || 'a card')}</strong>`
    const titleLinked = link ? `<a href="${link}" style="color:#4f46e5; text-decoration:none;">${title}</a>` : title
    const verb = isMention ? 'mentioned you on' : 'commented on'
    const prefix = isMention ? '<strong>@you</strong> ' : ''
    return `${prefix}${escape(r.payload.actor_name || 'Someone')} ${verb} ${titleLinked}: <em style="color:#6b7280;">${escape(r.payload.snippet || '').slice(0, 100)}</em>`
  })

  // Other task events (declined / completed / reassigned) — currently the
  // existing `notify` function emails these instantly. We enqueue them too
  // as a future-proof; for now they'll appear here only if the instant path
  // didn't hit (e.g. webhook secret missing).
  section('Task updates', (byType['task_completed'] || []).concat(byType['task_declined'] || []).concat(byType['task_reassigned'] || []), (r) =>
    `<strong>${escape(r.payload.task_title || 'Task')}</strong> ${r.event_type.replace('task_', '')}`
  )

  const subject = totalCount === 1
    ? `1 new notification`
    : `${totalCount} new notifications`

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 20px; max-width: 600px; color: #111827;">
      <p style="font-size: 14px; color: #6b7280; margin: 0 0 12px;">Hi ${escape(userName || 'there')},</p>
      <h2 style="font-size: 20px; margin: 0 0 8px; color: #111827;">You've got ${totalCount} update${totalCount === 1 ? '' : 's'} since you stepped away.</h2>
      ${sections.join('')}
      <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
        <a href="${PUBLIC_APP_URL}/my-tasks" style="display:inline-block; background:#6366f1; color:white; padding:10px 18px; border-radius:8px; text-decoration:none; font-weight: 500;">Open Hypr Task</a>
      </div>
      <p style="margin-top: 20px; font-size: 12px; color: #9ca3af;">
        Don't want these summaries? Toggle them off in <a href="${PUBLIC_APP_URL}/settings" style="color:#6b7280;">Settings</a>.
      </p>
    </div>
  `
  return { subject, html }
}

function escape(s: any): string {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Deployed --no-verify-jwt — pg_cron call from inside the project. The
  // function is read-only on profiles + outbox (no destructive actions),
  // and no PII leaks since it only emails verified addresses owned by
  // queued recipients. Matches the existing dm-offline-notify / spawn-
  // recurring-tasks pattern.

  const startedAt = Date.now()

  try {
    if (!RESEND_API_KEY) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500, headers: cors })
    }

    // 1) Find recipients with un-emailed outbox rows.
    const { data: pending, error: pendErr } = await supabase
      .from('notification_outbox')
      .select('id, recipient_id, event_type, payload, source_table, source_id, created_at')
      .is('emailed_at', null)
      .order('created_at', { ascending: true })
      .limit(2000)
    if (pendErr) {
      return new Response(JSON.stringify({ error: pendErr.message }), { status: 500, headers: cors })
    }
    if (!pending || pending.length === 0) {
      return new Response(JSON.stringify({
        ok: true,
        elapsed_ms: Date.now() - startedAt,
        considered: 0,
        sent: 0,
        skipped: { online: 0, opted_out: 0, no_email: 0 },
      }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // 2) Resolve recipient profiles for ALL pending rows up front. We do this
    //    before claiming so the skip-batch path (no email / opted out / online /
    //    profile missing) can still mark rows as emailed in a single batch
    //    without a wasted claim-then-release round-trip.
    const allRecipientIds = Array.from(new Set(pending.map((r: OutboxRow) => r.recipient_id)))
    const { data: profiles, error: profErr } = await supabase
      .from('profiles')
      .select('id, email, full_name, email_digest_enabled, last_seen_at')
      .in('id', allRecipientIds)
    if (profErr) {
      return new Response(JSON.stringify({ error: profErr.message }), { status: 500, headers: cors })
    }
    const profileById = new Map<string, RecipientProfile>(
      (profiles as RecipientProfile[]).map((p) => [p.id, p])
    )

    // 3) Reset abandoned claims left by a crashed prior run (older than
    //    10 min — see migration 078).
    const { error: resetErr } = await supabase.rpc('reset_stale_outbox_claims')
    if (resetErr) {
      console.warn('digest: reset_stale_outbox_claims failed:', resetErr.message)
    }

    // 4) Atomically claim the rows we plan to email. A second concurrent
    //    digest run will see these rows as already claimed and skip them,
    //    eliminating the duplicate-email race (#6).
    //
    //    Scope: ONLY the row IDs we just SELECTed, AND only those still
    //    unclaimed and un-emailed (a concurrent run may have raced us).
    const allRowIds = (pending as OutboxRow[]).map((r) => r.id)
    const { data: claimed, error: claimErr } = await supabase
      .from('notification_outbox')
      .update({ claimed_at: new Date().toISOString() })
      .in('id', allRowIds)
      .is('claimed_at', null)
      .is('emailed_at', null)
      .select('id, recipient_id, event_type, payload, source_table, source_id, created_at')
    if (claimErr) {
      return new Response(JSON.stringify({ error: claimErr.message }), { status: 500, headers: cors })
    }
    const claimedRows = (claimed || []) as OutboxRow[]
    const claimedIds = new Set(claimedRows.map((r) => r.id))

    // 5) Re-bucket only the claimed rows by recipient.
    const claimedByRecipient: Record<string, OutboxRow[]> = {}
    for (const r of claimedRows) {
      if (!claimedByRecipient[r.recipient_id]) claimedByRecipient[r.recipient_id] = []
      claimedByRecipient[r.recipient_id].push(r)
    }

    // 6) Build send jobs and a list of skip-row IDs (online / opted out / no
    //    email / missing profile). Skip rows are batch-marked emailed so the
    //    queue actually moves and the partial index stays small (#H1).
    const offlineCutoff = new Date(Date.now() - OFFLINE_WINDOW_MINUTES * 60 * 1000)
    let sent = 0
    let failed = 0
    let skipOnline = 0
    let skipOptedOut = 0
    let skipNoEmail = 0
    let skipNoProfile = 0

    type SendJob = { recipientId: string; rows: OutboxRow[]; prof: RecipientProfile }
    const sendJobs: SendJob[] = []
    const skipRowIds: string[] = []

    for (const [recipientId, rows] of Object.entries(claimedByRecipient)) {
      const prof = profileById.get(recipientId)
      if (!prof) {
        // Recipient profile missing — drop these rows so we don't keep retrying.
        skipNoProfile++
        skipRowIds.push(...rows.map((r) => r.id))
        continue
      }
      if (!prof.email) {
        skipNoEmail++
        skipRowIds.push(...rows.map((r) => r.id))
        continue
      }
      if (!prof.email_digest_enabled) {
        skipOptedOut++
        skipRowIds.push(...rows.map((r) => r.id))
        continue
      }
      const lastSeen = prof.last_seen_at ? new Date(prof.last_seen_at) : null
      const isOnline = lastSeen !== null && lastSeen > offlineCutoff
      if (isOnline) {
        skipOnline++
        skipRowIds.push(...rows.map((r) => r.id))
        continue
      }
      sendJobs.push({ recipientId, rows, prof })
    }

    // 7) Mark all skip rows as emailed in a single bounded batch. The .in()
    //    list is strictly the row IDs we accumulated above, so we never
    //    touch unrelated rows.
    if (skipRowIds.length > 0) {
      const { error: skipErr } = await supabase
        .from('notification_outbox')
        .update({ emailed_at: new Date().toISOString() })
        .in('id', skipRowIds)
      if (skipErr) {
        console.warn('digest: failed to mark skip rows emailed:', skipErr.message)
        // Non-fatal — they'll retry next tick after the stale-claim reset.
      }
    }

    // 8) Send emails with a concurrency cap. Resend success ⇒ mark emailed_at;
    //    Resend failure ⇒ release the claim so the next tick retries.
    const CONCURRENCY = 8
    async function runJob(job: SendJob) {
      const rowIds = job.rows.map((r) => r.id)
      try {
        const { subject, html } = renderDigestHtml(job.rows, job.prof.full_name || '')
        const ok = await sendEmail(job.prof.email!, subject, html)
        if (ok) {
          sent++
          await supabase
            .from('notification_outbox')
            .update({ emailed_at: new Date().toISOString() })
            .in('id', rowIds)
        } else {
          failed++
          console.warn(`Failed to send digest to ${job.prof.email}; releasing claim for retry`)
          const { error: relErr } = await supabase
            .from('notification_outbox')
            .update({ claimed_at: null })
            .in('id', rowIds)
          if (relErr) {
            console.warn(`digest: claim-release failed for ${job.prof.email} (rows will recover via stale-claim reset on next tick):`, relErr.message)
          }
        }
      } catch (e) {
        failed++
        console.error('digest send threw:', e)
        // Best-effort claim release so the row isn't stuck for 10 min.
        const { error: relErr } = await supabase
          .from('notification_outbox')
          .update({ claimed_at: null })
          .in('id', rowIds)
        if (relErr) {
          console.warn(`digest: post-throw claim-release failed (rows will recover via stale-claim reset):`, relErr.message)
        }
      }
    }

    const queue = sendJobs.slice()
    const workerCount = Math.min(CONCURRENCY, queue.length)
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const job = queue.shift()
        if (!job) return
        await runJob(job)
      }
    })
    await Promise.all(workers)

    return new Response(
      JSON.stringify({
        ok: true,
        elapsed_ms: Date.now() - startedAt,
        considered: pending.length,
        claimed: claimedIds.size,
        sent,
        failed,
        skipped: {
          online: skipOnline,
          opted_out: skipOptedOut,
          no_email: skipNoEmail,
          no_profile: skipNoProfile,
        },
      }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('notification-digest error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors })
  }
})
