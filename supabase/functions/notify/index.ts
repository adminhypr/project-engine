// supabase/functions/notify/index.ts
// Instant notifications triggered by database webhooks
// Deploy: npx supabase functions deploy notify
//
// Set up database webhooks in Supabase Dashboard:
//   Database → Webhooks → Create:
//   1. Table: tasks, Events: INSERT → POST to this function URL with payload
//   2. Table: tasks, Events: UPDATE → POST to this function URL with payload

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('ALERT_FROM_EMAIL') || 'alerts@hyprassistants.com'
const APP_URL = Deno.env.get('APP_URL') || 'https://tasks.hyprstaffing.com'

// ── Email sender ──────────────────────────────
async function sendEmail(to: string[], subject: string, html: string) {
  if (!RESEND_API_KEY) return false

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Hypr Task <${FROM_EMAIL}>`,
      to,
      subject,
      html,
    }),
  })

  if (!res.ok) {
    console.error('Resend error:', res.status, await res.text())
    return false
  }
  return true
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

  const dueInfo = task.due_date
    ? `<tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Due</td><td style="padding: 6px 0; font-size: 14px;">${new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td></tr>`
    : ''

  const html = emailWrap('New Task Assigned to You', '#6366f1',
    `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${task.assignee.full_name}</strong>,</p>
     <p style="margin: 0 0 16px; color: #374151;"><strong>${task.assigner?.full_name}</strong> has assigned you a new task:</p>
     <div style="background: #f8f9fc; border-radius: 10px; padding: 16px; margin: 12px 0;">
       <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #111827;">${task.title}</p>
       <p style="margin: 0; font-size: 13px; color: #6b7280;">${task.task_id}${task.who_due_to ? ` · For: ${task.who_due_to}` : ''}</p>
     </div>
     <table style="width: 100%; border-collapse: collapse;">
       <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px; width: 120px;">Urgency</td><td style="padding: 6px 0; font-size: 14px;">${task.urgency}</td></tr>
       <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Team</td><td style="padding: 6px 0; font-size: 14px;">${task.team?.name || '—'}</td></tr>
       ${dueInfo}
       ${task.notes ? `<tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px; vertical-align: top;">Notes</td><td style="padding: 6px 0; font-size: 14px; color: #374151;">${task.notes}</td></tr>` : ''}
     </table>
     ${task.acceptance_status === 'Pending' ? `
       <div style="padding: 12px; background: #fefce8; border-radius: 8px; text-align: center; margin-top: 16px;">
         <strong style="color: #854d0e;">This task requires your acceptance</strong>
       </div>` : ''}
     <div style="margin-top: 20px; text-align: center;">
       <a href="${APP_URL}/my-tasks" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">View Task</a>
     </div>`)

  await sendEmail([task.assignee.email], `New task: "${task.title}"`, html)
}

// ── 2. TASK DECLINED — notify assigner ────────
async function onTaskDeclined(record: any, oldRecord: any) {
  if (oldRecord.acceptance_status === 'Declined') return // already declined
  if (record.acceptance_status !== 'Declined') return

  const task = await getTask(record.id)
  if (!task?.assigner?.email) return
  if (task.assigned_by === task.assigned_to) return // self-assigned

  const html = emailWrap('Task Declined', '#ef4444',
    `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${task.assigner.full_name}</strong>,</p>
     <p style="margin: 0 0 16px; color: #374151;"><strong>${task.assignee?.full_name}</strong> has declined the following task:</p>
     <div style="background: #f8f9fc; border-radius: 10px; padding: 16px; margin: 12px 0;">
       <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #111827;">${task.title}</p>
       <p style="margin: 0; font-size: 13px; color: #6b7280;">${task.task_id}</p>
     </div>
     ${record.decline_reason ? `
       <div style="padding: 12px; background: #fef2f2; border-radius: 8px; margin: 12px 0;">
         <p style="margin: 0; font-size: 13px; color: #6b7280;">Reason:</p>
         <p style="margin: 4px 0 0; font-size: 14px; color: #374151; font-style: italic;">"${record.decline_reason}"</p>
       </div>` : ''}
     <p style="margin: 16px 0 0; font-size: 14px; color: #374151;">You can reassign this task from the task detail panel.</p>
     <div style="margin-top: 20px; text-align: center;">
       <a href="${APP_URL}/my-tasks" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">Reassign Task</a>
     </div>`)

  await sendEmail([task.assigner.email], `Task declined: "${task.title}"`, html)
}

// ── 3. TASK COMPLETED — notify assigner ───────
async function onTaskCompleted(record: any, oldRecord: any) {
  if (oldRecord.status === 'Done') return // already done
  if (record.status !== 'Done') return

  const task = await getTask(record.id)
  if (!task?.assigner?.email) return
  if (task.assigned_by === task.assigned_to) return

  const html = emailWrap('Task Completed', '#22c55e',
    `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${task.assigner.full_name}</strong>,</p>
     <p style="margin: 0 0 16px; color: #374151;"><strong>${task.assignee?.full_name}</strong> has completed a task:</p>
     <div style="background: #f0fdf4; border-radius: 10px; padding: 16px; margin: 12px 0;">
       <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #111827;">✓ ${task.title}</p>
       <p style="margin: 0; font-size: 13px; color: #6b7280;">${task.task_id}${task.who_due_to ? ` · For: ${task.who_due_to}` : ''}</p>
     </div>
     <div style="margin-top: 20px; text-align: center;">
       <a href="${APP_URL}/my-tasks" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">View Details</a>
     </div>`)

  await sendEmail([task.assigner.email], `Task completed: "${task.title}"`, html)
}

// ── 4. TASK REASSIGNED — notify new assignee ──
async function onTaskReassigned(record: any, oldRecord: any) {
  if (oldRecord.assigned_to === record.assigned_to) return // not reassigned

  const task = await getTask(record.id)
  if (!task?.assignee?.email) return
  if (task.assigned_to === task.assigned_by) return

  const html = emailWrap('Task Reassigned to You', '#6366f1',
    `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${task.assignee.full_name}</strong>,</p>
     <p style="margin: 0 0 16px; color: #374151;">A task has been reassigned to you:</p>
     <div style="background: #f8f9fc; border-radius: 10px; padding: 16px; margin: 12px 0;">
       <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #111827;">${task.title}</p>
       <p style="margin: 0; font-size: 13px; color: #6b7280;">${task.task_id}</p>
     </div>
     <table style="width: 100%; border-collapse: collapse;">
       <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px; width: 120px;">Assigned By</td><td style="padding: 6px 0; font-size: 14px;">${task.assigner?.full_name}</td></tr>
       <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Urgency</td><td style="padding: 6px 0; font-size: 14px;">${task.urgency}</td></tr>
       ${task.due_date ? `<tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Due</td><td style="padding: 6px 0; font-size: 14px;">${new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td></tr>` : ''}
     </table>
     ${task.acceptance_status === 'Pending' ? `
       <div style="padding: 12px; background: #fefce8; border-radius: 8px; text-align: center; margin-top: 16px;">
         <strong style="color: #854d0e;">This task requires your acceptance</strong>
       </div>` : ''}
     <div style="margin-top: 20px; text-align: center;">
       <a href="${APP_URL}/my-tasks" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">View Task</a>
     </div>`)

  await sendEmail([task.assignee.email], `Task reassigned to you: "${task.title}"`, html)
}

// ── Webhook handler ───────────────────────────
Deno.serve(async (req) => {
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500 })
  }

  try {
    const payload = await req.json()
    const { type, record, old_record } = payload

    // INSERT — new task assigned
    if (type === 'INSERT' && record) {
      await onTaskCreated(record)
      return new Response(JSON.stringify({ action: 'task_created', ok: true }), { status: 200 })
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

      return new Response(JSON.stringify({ actions, ok: true }), { status: 200 })
    }

    return new Response(JSON.stringify({ action: 'none', ok: true }), { status: 200 })
  } catch (err) {
    console.error('Notify error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
  }
})
