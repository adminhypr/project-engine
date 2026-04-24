// Offline-delay email notifier for unread direct messages.
// Scheduled to run every 60s. Flushes pending_dm_emails rows older than 3 minutes
// to Resend, skipping rows where the recipient has read the conversation since.
// Enforces a 15-minute debounce per (recipient, conversation) via dm_email_log.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor, verifyWebhookSecret } from '../_shared/security.ts'

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY    = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL        = Deno.env.get('DM_FROM_EMAIL')
                          ?? Deno.env.get('ALERT_FROM_EMAIL')
                          ?? 'alerts@hyprassistants.com'
const APP_URL           = Deno.env.get('APP_URL') ?? 'https://example.com'

const DELAY_MIN         = 3
const DEBOUNCE_MIN      = 15

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: `Hypr Task <${FROM_EMAIL}>`, to, subject, html }),
  })
  if (!res.ok) {
    console.error('Resend failed', res.status, await res.text())
    return false
  }
  return true
}

async function flush() {
  const threshold = new Date(Date.now() - DELAY_MIN * 60_000).toISOString()

  const { data: pending, error } = await supabase
    .from('pending_dm_emails')
    .select(`
      id, message_id, conversation_id, recipient_id, enqueued_at,
      message:dm_messages(id, content, author_id, created_at,
                         author:profiles!dm_messages_author_id_fkey(id, full_name)),
      recipient:profiles!pending_dm_emails_recipient_id_fkey(id, email, full_name),
      conversation:conversations!pending_dm_emails_conversation_id_fkey(id, kind, task_id)
    `)
    .is('sent_at', null)
    .is('skipped_reason', null)
    .lte('enqueued_at', threshold)
    .limit(200)

  if (error) { console.error(error); return { flushed: 0 } }
  if (!pending || pending.length === 0) return { flushed: 0 }

  let sent = 0

  // Group by (recipient, conversation) so one email covers a burst.
  const groups = new Map<string, typeof pending>()
  for (const row of pending) {
    const k = `${row.recipient_id}::${row.conversation_id}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(row)
  }

  for (const [, rows] of groups) {
    const first = rows[0]
    const recipient = first.recipient
    const conversationId = first.conversation_id

    // Skip if recipient has read the conversation since the earliest queued message
    const { data: partRow } = await supabase
      .from('conversation_participants')
      .select('last_read_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', recipient.id)
      .maybeSingle()

    const earliestMessageAt = rows.reduce(
      (acc, r) => Math.min(acc, Date.parse(r.message.created_at)),
      Infinity
    )
    const readAtMs = partRow?.last_read_at ? Date.parse(partRow.last_read_at) : 0

    if (readAtMs >= earliestMessageAt) {
      await supabase.from('pending_dm_emails').update({
        skipped_reason: 'read',
        sent_at: new Date().toISOString(),
      }).in('id', rows.map(r => r.id))
      continue
    }

    // Debounce: was an email sent to this (recipient, conversation) in the last 15 min?
    const debounceThreshold = new Date(Date.now() - DEBOUNCE_MIN * 60_000).toISOString()
    const { data: recent } = await supabase
      .from('dm_email_log')
      .select('sent_at')
      .eq('recipient_id', recipient.id)
      .eq('conversation_id', conversationId)
      .gte('sent_at', debounceThreshold)
      .limit(1)

    if (recent && recent.length > 0) {
      await supabase.from('pending_dm_emails').update({
        skipped_reason: 'debounced',
        sent_at: new Date().toISOString(),
      }).in('id', rows.map(r => r.id))
      continue
    }

    const senderName = first.message.author?.full_name || 'A coworker'
    const subject = `New messages from ${senderName}`
    const lines = rows.map(r =>
      `<div style="margin:6px 0;padding:6px 10px;background:#f3f4f6;border-radius:8px;">
        <div style="font-size:11px;color:#6b7280;">${new Date(r.message.created_at).toLocaleTimeString()}</div>
        <div>${escapeHtml(r.message.content || '')}</div>
      </div>`
    ).join('')

    // Task chats deep-link to the task detail panel; DM/group open the app root
    // (the chat widget handles routing to the conversation from there).
    const conv: any = (first as any).conversation
    const linkUrl = conv?.kind === 'task' && conv?.task_id
      ? `${APP_URL}/my-tasks?task=${conv.task_id}`
      : APP_URL
    const linkLabel = conv?.kind === 'task' ? 'Open Task' : 'Open Project Engine'

    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:560px;">
        <h2 style="font-size:16px;">You have unread messages from ${escapeHtml(senderName)}</h2>
        ${lines}
        <p><a href="${linkUrl}" style="color:#3b82f6;">${linkLabel}</a></p>
      </div>`

    const ok = await sendEmail(recipient.email, subject, html)

    if (ok) {
      await supabase.from('pending_dm_emails').update({
        sent_at: new Date().toISOString(),
      }).in('id', rows.map(r => r.id))
      await supabase.from('dm_email_log').insert({
        recipient_id: recipient.id,
        conversation_id: conversationId,
      })
      sent += rows.length
    } else {
      await supabase.from('pending_dm_emails').update({
        skipped_reason: 'resend_failed',
        sent_at: new Date().toISOString(),
      }).in('id', rows.map(r => r.id))
    }
  }

  return { flushed: sent }
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  // H-1: verify shared secret (soft-fail if env var not set).
  if (!verifyWebhookSecret(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  const result = await flush()
  return new Response(JSON.stringify(result), {
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
})
