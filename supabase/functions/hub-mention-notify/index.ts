// supabase/functions/hub-mention-notify/index.ts
// Email notification for hub @mentions.
// Triggered by database webhook on hub_mentions INSERT.
// Deploy: npx supabase functions deploy hub-mention-notify
//
// Set up database webhook in Supabase Dashboard:
//   Database → Webhooks → Create:
//   Table: hub_mentions, Events: INSERT → POST to this function URL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor, verifyWebhookSecret } from '../_shared/security.ts'
import { isProfileOnline } from '../_shared/presence.ts'
import { sendEmail } from '../_shared/email.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const APP_URL = Deno.env.get('APP_URL') || 'https://tasks.hyprstaffing.com'

function emailWrap(title: string, color: string, body: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif; max-width: 560px; margin: 0 auto; background: #f8f9fc; padding: 24px;">
      <div style="background: white; border-radius: 16px; border: 1px solid #e2e5ee; overflow: hidden;">
        <div style="background: ${color}; padding: 16px 24px;">
          <h2 style="margin: 0; font-size: 15px; color: white; font-weight: 600;">${title}</h2>
        </div>
        <div style="padding: 24px;">
          ${body}
        </div>
      </div>
      <p style="text-align: center; margin-top: 16px; font-size: 12px; color: #9aa1b3;">
        <a href="${APP_URL}" style="color: #6366f1; text-decoration: none;">Open Hypr Task</a>
      </p>
    </div>`
}

const MODULE_LABELS: Record<string, string> = {
  chat: 'Campfire',
  message: 'Message Board',
  message_reply: 'Message Board',
  check_in_response: 'Check-ins',
  todo_note: 'To-dos',
  todo_comment: 'To-dos',
  todo_list: 'To-dos',
}

async function getMessagePreview(entityType: string, entityId: string): Promise<string> {
  let content = ''

  if (entityType === 'chat') {
    const { data } = await supabase
      .from('hub_chat_messages')
      .select('content')
      .eq('id', entityId)
      .single()
    content = data?.content || ''
  } else if (entityType === 'message' || entityType === 'message_reply') {
    const { data } = await supabase
      .from('hub_messages')
      .select('content')
      .eq('id', entityId)
      .single()
    content = data?.content || ''
  } else if (entityType === 'check_in_response') {
    const { data } = await supabase
      .from('hub_check_in_responses')
      .select('content')
      .eq('id', entityId)
      .single()
    content = data?.content || ''
  } else if (entityType === 'todo_note') {
    const { data } = await supabase
      .from('hub_todo_items')
      .select('notes, title')
      .eq('id', entityId)
      .single()
    content = data?.notes || data?.title || ''
  } else if (entityType === 'todo_comment') {
    const { data } = await supabase
      .from('hub_todo_comments')
      .select('content')
      .eq('id', entityId)
      .single()
    content = data?.content || ''
  } else if (entityType === 'todo_list') {
    const { data } = await supabase
      .from('hub_todo_lists')
      .select('description, title')
      .eq('id', entityId)
      .single()
    content = data?.description || data?.title || ''
  }

  if (entityType.startsWith('todo_')) {
    content = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  // Truncate for email preview
  if (content.length > 200) content = content.slice(0, 200) + '...'
  return content
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  // H-1: verify shared secret (strict — rejects if WEBHOOK_SHARED_SECRET unset).
  if (!verifyWebhookSecret(req)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })
  }

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500, headers: cors })
  }

  try {
    const payload = await req.json()
    const { type, record } = payload

    if (type !== 'INSERT' || !record) {
      return new Response(JSON.stringify({ action: 'none', ok: true }), { status: 200, headers: cors })
    }

    // Skip self-mentions
    if (record.mentioned_by === record.mentioned_user) {
      return new Response(JSON.stringify({ action: 'self_mention_skipped', ok: true }), { status: 200, headers: cors })
    }

    // Skip if recipient is online — bell already covers them, and the
    // 15-min digest cron will catch up with anything missed.
    if (await isProfileOnline(record.mentioned_user)) {
      return new Response(JSON.stringify({ action: 'recipient_online_skip', ok: true }), { status: 200, headers: cors })
    }

    // Fetch mentioned user's email
    const { data: mentionedUser } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', record.mentioned_user)
      .single()
    if (!mentionedUser?.email) {
      return new Response(JSON.stringify({ action: 'no_email', ok: true }), { status: 200, headers: cors })
    }

    // Fetch mentioner's name
    const { data: mentioner } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', record.mentioned_by)
      .single()

    // Fetch hub name
    const { data: hub } = await supabase
      .from('hubs')
      .select('name')
      .eq('id', record.hub_id)
      .single()

    const mentionerName = mentioner?.full_name || 'Someone'
    const hubName = hub?.name || 'a hub'
    const moduleLabel = MODULE_LABELS[record.entity_type] || 'Hub'
    const preview = await getMessagePreview(record.entity_type, record.entity_id)

    const html = emailWrap(`You were mentioned in ${hubName}`, '#6366f1',
      `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${mentionedUser.full_name}</strong>,</p>
       <p style="margin: 0 0 16px; color: #374151;"><strong>${mentionerName}</strong> mentioned you in <strong>${hubName}</strong> — ${moduleLabel}:</p>
       <div style="background: #f8f9fc; border-radius: 10px; padding: 16px; margin: 12px 0;">
         <p style="margin: 0; font-size: 14px; color: #374151; font-style: italic;">"${preview}"</p>
       </div>
       <div style="margin-top: 20px; text-align: center;">
         <a href="${APP_URL}/hub/${record.hub_id}" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">Open Hub</a>
       </div>`)

    const result = await sendEmail([mentionedUser.email], `${mentionerName} mentioned you in ${hubName}`, html)
    if (!result.ok) {
      // The mention itself is already persisted in `hub_mentions`, so a
      // failed email doesn't lose data — the bell will still fire and the
      // 15-min digest will sweep it. Just log so ops can spot recurring
      // permanent failures.
      const level = result.retryable ? 'warn' : 'error'
      console[level](`hub-mention-notify: send failed (status=${result.status}, retryable=${result.retryable}): ${result.error}`)
    }

    return new Response(
      JSON.stringify({ action: 'mention_email_sent', ok: result.ok, send_error: result.ok ? undefined : result.error }),
      { status: 200, headers: cors }
    )
  } catch (err) {
    console.error('Hub mention notify error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors })
  }
})
