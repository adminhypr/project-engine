// supabase/functions/notify/index.ts
// Instant notifications triggered by database webhooks
// Deploy: npx supabase functions deploy notify
//
// Set up database webhooks in Supabase Dashboard:
//   Database → Webhooks → Create:
//   1. Table: tasks, Events: INSERT → POST to this function URL with payload
//   2. Table: tasks, Events: UPDATE → POST to this function URL with payload

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { isProfileOnline } from '../_shared/presence.ts'
import { corsHeadersFor, verifyWebhookSecret } from '../_shared/security.ts'
import { sendEmail as sharedSendEmail, type SendResult } from '../_shared/email.ts'
import { escapeHtml } from '../_shared/html.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const APP_URL = Deno.env.get('APP_URL') || 'https://tasks.hyprstaffing.com'

// ── Email sender ──────────────────────────────
// Thin wrapper over the shared helper. Tags every send with source='notify'
// so the helper logs permanent failures to public.notify_failures (mig 089).
// Optional ctx is attached as the jsonb context column.
async function sendEmail(to: string[], subject: string, html: string, ctx?: Record<string, unknown>): Promise<SendResult> {
  const result = await sharedSendEmail(to, subject, html, { source: 'notify', context: ctx })
  if (!result.ok && result.retryable) {
    console.warn(`notify: send exhausted retries (status=${result.status}) to=${JSON.stringify(to)} subject=${JSON.stringify(subject)}: ${result.error}`)
  }
  // Permanent failures are now persisted by the shared helper itself.
  return result
}

// ── Email template ────────────────────────────
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

// ── Fetch full task with joins ────────────────
async function getTask(taskId: string) {
  const { data } = await supabase
    .from('tasks')
    .select(`*, assignee:profiles!tasks_assigned_to_fkey(id, full_name, email), assigner:profiles!tasks_assigned_by_fkey(id, full_name, email), team:teams(name)`)
    .eq('id', taskId)
    .single()
  return data
}

// ── 1. TASK ASSIGNED — notify assignee ────────
async function onTaskCreated(record: any) {
  const task = await getTask(record.id)
  if (!task?.assignee?.email) return

  // Don't email yourself for self-assignments
  if (task.assigned_to === task.assigned_by) return

  // Skip the instant email if the recipient is currently online — the bell
  // already covers them, and the 15-min digest will catch anything missed.
  if (await isProfileOnline(task.assigned_to)) return

  const dueInfo = task.due_date
    ? `<tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Due</td><td style="padding: 6px 0; font-size: 14px;">${new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td></tr>`
    : ''

  const html = emailWrap('New Task Assigned to You', '#6366f1',
    `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${escapeHtml(task.assignee.full_name)}</strong>,</p>
     <p style="margin: 0 0 16px; color: #374151;"><strong>${escapeHtml(task.assigner?.full_name)}</strong> has assigned you a new task:</p>
     <div style="background: #f8f9fc; border-radius: 10px; padding: 16px; margin: 12px 0;">
       <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #111827;">${escapeHtml(task.title)}</p>
       <p style="margin: 0; font-size: 13px; color: #6b7280;">${escapeHtml(task.task_id)}${task.who_due_to ? ` · For: ${escapeHtml(task.who_due_to)}` : ''}</p>
     </div>
     <table style="width: 100%; border-collapse: collapse;">
       <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px; width: 120px;">Urgency</td><td style="padding: 6px 0; font-size: 14px;">${escapeHtml(task.urgency)}</td></tr>
       <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Team</td><td style="padding: 6px 0; font-size: 14px;">${task.team?.name ? escapeHtml(task.team.name) : '—'}</td></tr>
       ${dueInfo}
       ${task.notes ? `<tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px; vertical-align: top;">Notes</td><td style="padding: 6px 0; font-size: 14px; color: #374151;">${escapeHtml(task.notes)}</td></tr>` : ''}
     </table>
     ${task.acceptance_status === 'Pending' ? `
       <div style="padding: 12px; background: #fefce8; border-radius: 8px; text-align: center; margin-top: 16px;">
         <strong style="color: #854d0e;">This task requires your acceptance</strong>
       </div>` : ''}
     <div style="margin-top: 20px; text-align: center;">
       <a href="${APP_URL}/my-tasks?task=${task.id}" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">View Task</a>
     </div>`)

  await sendEmail([task.assignee.email], `New task: "${task.title}"`, html, { task_id: task.id, event: 'task_assigned' })
}

// ── 2. TASK DECLINED — notify assigner ────────
async function onTaskDeclined(record: any, oldRecord: any) {
  if (oldRecord.acceptance_status === 'Declined') return // already declined
  if (record.acceptance_status !== 'Declined') return

  const task = await getTask(record.id)
  if (!task?.assigner?.email) return
  if (task.assigned_by === task.assigned_to) return // self-assigned
  if (await isProfileOnline(task.assigned_by)) return

  const html = emailWrap('Task Declined', '#ef4444',
    `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${escapeHtml(task.assigner.full_name)}</strong>,</p>
     <p style="margin: 0 0 16px; color: #374151;"><strong>${escapeHtml(task.assignee?.full_name)}</strong> has declined the following task:</p>
     <div style="background: #f8f9fc; border-radius: 10px; padding: 16px; margin: 12px 0;">
       <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #111827;">${escapeHtml(task.title)}</p>
       <p style="margin: 0; font-size: 13px; color: #6b7280;">${escapeHtml(task.task_id)}</p>
     </div>
     ${record.decline_reason ? `
       <div style="padding: 12px; background: #fef2f2; border-radius: 8px; margin: 12px 0;">
         <p style="margin: 0; font-size: 13px; color: #6b7280;">Reason:</p>
         <p style="margin: 4px 0 0; font-size: 14px; color: #374151; font-style: italic;">"${escapeHtml(record.decline_reason)}"</p>
       </div>` : ''}
     <p style="margin: 16px 0 0; font-size: 14px; color: #374151;">You can reassign this task from the task detail panel.</p>
     <div style="margin-top: 20px; text-align: center;">
       <a href="${APP_URL}/my-tasks?task=${task.id}" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">Reassign Task</a>
     </div>`)

  await sendEmail([task.assigner.email], `Task declined: "${task.title}"`, html, { task_id: task.id, event: 'task_declined' })
}

// ── 3. TASK COMPLETED — notify assigner ───────
async function onTaskCompleted(record: any, oldRecord: any) {
  if (oldRecord.status === 'Done') return // already done
  if (record.status !== 'Done') return

  const task = await getTask(record.id)
  if (!task) return

  // Detect force-close: a recent task_audit_log row with event_type='force_closed'
  // written in the last minute means this Done flip came from force_close_task RPC.
  const { data: forceCloseRow } = await supabase
    .from('task_audit_log')
    .select('id, performed_by, created_at')
    .eq('task_id', record.id)
    .eq('event_type', 'force_closed')
    .gte('created_at', new Date(Date.now() - 60_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (forceCloseRow) {
    await onTaskForceClosed(task, forceCloseRow)
    return
  }

  // Regular completion path — notify assigner only.
  if (!task.assigner?.email) return
  if (task.assigned_by === task.assigned_to) return
  if (await isProfileOnline(task.assigned_by)) return

  const html = emailWrap('Task Completed', '#22c55e',
    `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${escapeHtml(task.assigner.full_name)}</strong>,</p>
     <p style="margin: 0 0 16px; color: #374151;"><strong>${escapeHtml(task.assignee?.full_name)}</strong> has completed a task:</p>
     <div style="background: #f0fdf4; border-radius: 10px; padding: 16px; margin: 12px 0;">
       <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #111827;">✓ ${escapeHtml(task.title)}</p>
       <p style="margin: 0; font-size: 13px; color: #6b7280;">${escapeHtml(task.task_id)}${task.who_due_to ? ` · For: ${escapeHtml(task.who_due_to)}` : ''}</p>
     </div>
     <div style="margin-top: 20px; text-align: center;">
       <a href="${APP_URL}/my-tasks?task=${task.id}" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">View Details</a>
     </div>`)

  await sendEmail([task.assigner.email], `Task completed: "${task.title}"`, html, { task_id: task.id, event: 'task_completed' })
}

// ── 3b. TASK FORCE-CLOSED — notify all assignees + assigner ───
async function onTaskForceClosed(task: any, forceCloseRow: any) {
  // Fetch closer name
  let closerName = 'A manager'
  if (forceCloseRow.performed_by) {
    const { data: closer } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', forceCloseRow.performed_by)
      .maybeSingle()
    if (closer?.full_name) closerName = closer.full_name
  }

  // Fetch all assignees from junction table
  const { data: assigneeRows } = await supabase
    .from('task_assignees')
    .select('profile:profiles(id, full_name, email)')
    .eq('task_id', task.id)

  // Collect unique recipients: assigner + every assignee with an email.
  const recipients = new Map<string, { id: string; full_name: string; email: string }>()
  if (task.assigner?.id && task.assigner?.email) {
    recipients.set(task.assigner.id, {
      id: task.assigner.id,
      full_name: task.assigner.full_name,
      email: task.assigner.email,
    })
  }
  for (const row of assigneeRows || []) {
    const p: any = (row as any).profile
    if (p?.id && p?.email && !recipients.has(p.id)) {
      recipients.set(p.id, { id: p.id, full_name: p.full_name, email: p.email })
    }
  }

  if (recipients.size === 0) return

  const subject = closerName
    ? `Task closed by ${closerName}: "${task.title}"`
    : `Task closed: "${task.title}"`

  for (const r of recipients.values()) {
    if (await isProfileOnline(r.id)) continue
    const html = emailWrap('Task Closed', '#22c55e',
      `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${escapeHtml(r.full_name)}</strong>,</p>
       <p style="margin: 0 0 16px; color: #374151;"><strong>${escapeHtml(closerName)}</strong> has closed the following task for everyone:</p>
       <div style="background: #f0fdf4; border-radius: 10px; padding: 16px; margin: 12px 0;">
         <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #111827;">✓ ${escapeHtml(task.title)}</p>
         <p style="margin: 0; font-size: 13px; color: #6b7280;">${escapeHtml(task.task_id)}${task.who_due_to ? ` · For: ${escapeHtml(task.who_due_to)}` : ''}</p>
       </div>
       <p style="margin: 0 0 16px; color: #374151; font-size: 14px;">No further action is required on this task.</p>
       <div style="margin-top: 20px; text-align: center;">
         <a href="${APP_URL}/my-tasks?task=${task.id}" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">View Details</a>
       </div>`)

    await sendEmail([r.email], subject, html, { task_id: task.id, event: 'task_force_closed', recipient_id: r.id })
  }
}

// ── 4. TASK REASSIGNED — notify new assignee ──
async function onTaskReassigned(record: any, oldRecord: any) {
  if (oldRecord.assigned_to === record.assigned_to) return // not reassigned

  const task = await getTask(record.id)
  if (!task?.assignee?.email) return
  if (task.assigned_to === task.assigned_by) return
  if (await isProfileOnline(task.assigned_to)) return

  const html = emailWrap('Task Reassigned to You', '#6366f1',
    `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${escapeHtml(task.assignee.full_name)}</strong>,</p>
     <p style="margin: 0 0 16px; color: #374151;">A task has been reassigned to you:</p>
     <div style="background: #f8f9fc; border-radius: 10px; padding: 16px; margin: 12px 0;">
       <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #111827;">${escapeHtml(task.title)}</p>
       <p style="margin: 0; font-size: 13px; color: #6b7280;">${escapeHtml(task.task_id)}</p>
     </div>
     <table style="width: 100%; border-collapse: collapse;">
       <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px; width: 120px;">Assigned By</td><td style="padding: 6px 0; font-size: 14px;">${escapeHtml(task.assigner?.full_name)}</td></tr>
       <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Urgency</td><td style="padding: 6px 0; font-size: 14px;">${escapeHtml(task.urgency)}</td></tr>
       ${task.due_date ? `<tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Due</td><td style="padding: 6px 0; font-size: 14px;">${new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td></tr>` : ''}
     </table>
     ${task.acceptance_status === 'Pending' ? `
       <div style="padding: 12px; background: #fefce8; border-radius: 8px; text-align: center; margin-top: 16px;">
         <strong style="color: #854d0e;">This task requires your acceptance</strong>
       </div>` : ''}
     <div style="margin-top: 20px; text-align: center;">
       <a href="${APP_URL}/my-tasks?task=${task.id}" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">View Task</a>
     </div>`)

  await sendEmail([task.assignee.email], `Task reassigned to you: "${task.title}"`, html, { task_id: task.id, event: 'task_reassigned' })
}

async function onRecurringSpawnFailed(payload: any) {
  const { recurrence_id, template_title, creator_id } = payload

  // Resolve recipient: prefer the template creator; if creator was deleted,
  // ping every admin so it doesn't silently get stuck.
  let recipients: { email: string; full_name: string | null }[] = []
  if (creator_id) {
    const { data } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', creator_id)
      .maybeSingle()
    if (data?.email) recipients.push(data)
  }
  if (recipients.length === 0) {
    const { data } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('role', 'Admin')
    recipients = (data || []).filter((r) => r.email)
  }
  if (recipients.length === 0) return

  const rawTitle = String(template_title || 'Untitled')
  const safeTitle = escapeHtml(rawTitle)
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 20px; max-width: 560px;">
      <h2 style="color:#dc2626; margin: 0 0 12px;">Recurring task couldn't spawn</h2>
      <p style="color:#374151;">The template <strong>${safeTitle}</strong> reached its scheduled run, but had no valid assignees at the time. The template has been <strong>paused</strong> automatically.</p>
      <p style="color:#374151;">To resume it, open <a href="${(Deno.env.get('PUBLIC_APP_URL') || 'https://tasks.hyprstaffing.com')}/settings" style="color:#6366f1;">Settings → Recurring Tasks</a>, edit the template's assignees, and resume.</p>
      <p style="color:#9ca3af; font-size:12px; margin-top:24px;">Recurrence ID: ${recurrence_id}</p>
    </div>
  `
  await sendEmail(recipients.map((r) => r.email), `Recurring task paused: "${rawTitle}"`, html, { event: 'recurring_spawn_failed', recurrence_id: payload?.recurrence_id })
}

// ── Webhook handler ───────────────────────────
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
    const { type, record, old_record } = payload

    // Direct call from spawn-recurring-tasks when a template has no valid
    // assignees at spawn time. Email the creator (or fall back to admins
    // if creator has been deleted).
    if (type === 'recurring_spawn_failed') {
      await onRecurringSpawnFailed(payload)
      return new Response(JSON.stringify({ action: 'recurring_spawn_failed', ok: true }), { status: 200, headers: cors })
    }

    // INSERT — new task assigned
    if (type === 'INSERT' && record) {
      await onTaskCreated(record)
      return new Response(JSON.stringify({ action: 'task_created', ok: true }), { status: 200, headers: cors })
    }

    // UPDATE — check what changed
    if (type === 'UPDATE' && record && old_record) {
      const actions: string[] = []

      // Declined
      if (record.acceptance_status === 'Declined' && old_record.acceptance_status !== 'Declined') {
        await onTaskDeclined(record, old_record)
        actions.push('declined')
      }

      // Completed
      if (record.status === 'Done' && old_record.status !== 'Done') {
        await onTaskCompleted(record, old_record)
        actions.push('completed')
      }

      // Reassigned
      if (record.assigned_to !== old_record.assigned_to) {
        await onTaskReassigned(record, old_record)
        actions.push('reassigned')
      }

      return new Response(JSON.stringify({ actions, ok: true }), { status: 200, headers: cors })
    }

    return new Response(JSON.stringify({ action: 'none', ok: true }), { status: 200, headers: cors })
  } catch (err) {
    console.error('Notify error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors })
  }
})
