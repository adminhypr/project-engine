// supabase/functions/send-alerts/index.ts
// Cron-based notifications: red alerts, due reminders, stale task warnings
// Deploy: npx supabase functions deploy send-alerts
// Schedule: every 2 hours — npx supabase functions schedule send-alerts --cron "0 */2 * * *"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('ALERT_FROM_EMAIL') || 'alerts@hyprassistants.com'
const APP_URL = Deno.env.get('APP_URL') || 'https://project-engine.vercel.app'

// ── Email sender ──────────────────────────────
async function sendEmail(to: string[], subject: string, html: string, cc: string[] = []) {
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY not set — skipping email')
    return false
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Project Engine <${FROM_EMAIL}>`,
      to,
      cc: cc.length ? cc : undefined,
      subject,
      html,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('Resend error:', res.status, err)
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
        <a href="${APP_URL}" style="color: #6366f1; text-decoration: none;">Open Project Engine</a> · Automated notification
      </p>
    </div>`
}

function taskRow(label: string, value: string): string {
  return `<tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px; width: 120px;">${label}</td><td style="padding: 6px 0; font-size: 14px; color: #111827;">${value}</td></tr>`
}

function taskTable(task: any): string {
  return `
    <table style="width: 100%; border-collapse: collapse; margin: 12px 0;">
      ${taskRow('Task ID', task.task_id)}
      ${taskRow('Task', `<strong>${task.title}</strong>`)}
      ${taskRow('Urgency', task.urgency)}
      ${task.assigner?.full_name ? taskRow('Assigned By', task.assigner.full_name) : ''}
      ${task.who_due_to ? taskRow('For', task.who_due_to) : ''}
      ${task.due_date ? taskRow('Due Date', new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })) : ''}
      ${taskRow('Status', task.status)}
    </table>`
}

// ── Priority calculator ───────────────────────
function getPriority(task: any): string {
  const now = new Date()
  if (task.due_date) {
    const due = new Date(task.due_date)
    const diff = due.getTime() - now.getTime()
    const hrs = diff / 36e5
    if (diff < 0) return 'red'
    if (hrs < 12) return 'orange'
    if (hrs < 24) return 'yellow'
    return 'green'
  }
  if (task.last_updated) {
    const hrs = (now.getTime() - new Date(task.last_updated).getTime()) / 36e5
    if (hrs > 36) return 'red'
    if (hrs > 24) return 'orange'
    if (hrs > 12) return 'yellow'
    return 'green'
  }
  return 'none'
}

// ── Get manager for a user ────────────────────
async function getManagerEmail(task: any): Promise<string | null> {
  // First check reports_to
  if (task.assignee?.reports_to) {
    const { data: mgr } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', task.assignee.reports_to)
      .single()
    if (mgr) return mgr.email
  }
  // Fallback to team manager
  if (task.assignee?.team_id) {
    const { data: mgr } = await supabase
      .from('profiles')
      .select('email')
      .eq('team_id', task.assignee.team_id)
      .in('role', ['Manager', 'Admin'])
      .neq('id', task.assigned_to)
      .limit(1)
      .single()
    if (mgr) return mgr.email
  }
  return null
}

// ── 1. RED ALERTS — overdue / inactive ────────
async function sendRedAlerts(): Promise<number> {
  const { data: tasks } = await supabase
    .from('tasks')
    .select(`*, assignee:profiles!tasks_assigned_to_fkey(full_name, email, team_id, reports_to), assigner:profiles!tasks_assigned_by_fkey(full_name), team:teams(name)`)
    .eq('email_alert_sent', false)
    .neq('status', 'Done')
    .neq('acceptance_status', 'Declined')

  if (!tasks?.length) return 0

  const redTasks = tasks.filter(t => getPriority(t) === 'red')
  let sent = 0

  for (const task of redTasks) {
    const toEmail = task.assignee?.email
    if (!toEmail) continue

    const reason = task.due_date && new Date(task.due_date) < new Date()
      ? `Overdue since ${new Date(task.due_date).toLocaleDateString()}`
      : 'No update for over 36 hours'

    const html = emailWrap('Overdue Task — Action Required', '#ef4444',
      `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${task.assignee?.full_name}</strong>,</p>
       <p style="margin: 0 0 16px; color: #374151;">A task requires your immediate attention:</p>
       ${taskTable(task)}
       <div style="padding: 12px; background: #fef2f2; border-radius: 8px; text-align: center; margin-top: 16px;">
         <strong style="color: #991b1b;">${reason}</strong>
       </div>
       <div style="margin-top: 20px; text-align: center;">
         <a href="${APP_URL}/my-tasks" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">View Task</a>
       </div>`)

    const managerEmail = await getManagerEmail(task)
    const cc = managerEmail && managerEmail !== toEmail ? [managerEmail] : []
    const ok = await sendEmail([toEmail], `🔴 Overdue: "${task.title}" — Action Required`, html, cc)

    if (ok) {
      await supabase.from('tasks').update({ email_alert_sent: true }).eq('id', task.id)
      sent++
    }
  }
  return sent
}

// ── 2. DUE REMINDERS — 24h and 4h before ─────
async function sendDueReminders(): Promise<number> {
  const now = new Date()
  const in4h = new Date(now.getTime() + 4 * 36e5)
  const in24h = new Date(now.getTime() + 24 * 36e5)

  const { data: tasks } = await supabase
    .from('tasks')
    .select(`*, assignee:profiles!tasks_assigned_to_fkey(full_name, email, team_id, reports_to), assigner:profiles!tasks_assigned_by_fkey(full_name)`)
    .neq('status', 'Done')
    .neq('acceptance_status', 'Declined')
    .not('due_date', 'is', null)
    .gte('due_date', now.toISOString())
    .lte('due_date', in24h.toISOString())

  if (!tasks?.length) return 0

  let sent = 0

  for (const task of tasks) {
    const toEmail = task.assignee?.email
    if (!toEmail) continue

    const due = new Date(task.due_date)
    const hoursLeft = (due.getTime() - now.getTime()) / 36e5
    const isUrgent = hoursLeft <= 4

    // Check if we already sent a reminder at this level
    // Use a simple approach: check last_updated metadata
    const reminderKey = isUrgent ? 'reminder_4h_sent' : 'reminder_24h_sent'

    // Skip if a red alert was already sent (email_alert_sent covers that)
    if (task.email_alert_sent) continue

    const timeLabel = isUrgent
      ? `${Math.round(hoursLeft)} hours`
      : `${Math.round(hoursLeft)} hours`

    const color = isUrgent ? '#f97316' : '#eab308'
    const emoji = isUrgent ? '🟠' : '🟡'

    const html = emailWrap(`Due in ${timeLabel}`, color,
      `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${task.assignee?.full_name}</strong>,</p>
       <p style="margin: 0 0 16px; color: #374151;">You have a task due soon:</p>
       ${taskTable(task)}
       <div style="padding: 12px; background: ${isUrgent ? '#fff7ed' : '#fefce8'}; border-radius: 8px; text-align: center; margin-top: 16px;">
         <strong style="color: ${isUrgent ? '#9a3412' : '#854d0e'};">Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${due.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</strong>
       </div>
       <div style="margin-top: 20px; text-align: center;">
         <a href="${APP_URL}/my-tasks" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">View Task</a>
       </div>`)

    const ok = await sendEmail([toEmail], `${emoji} Due soon: "${task.title}"`, html)
    if (ok) sent++
  }
  return sent
}

// ── Main handler ──────────────────────────────
Deno.serve(async () => {
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500 })
  }

  const redSent = await sendRedAlerts()
  const reminderSent = await sendDueReminders()

  return new Response(JSON.stringify({
    red_alerts_sent: redSent,
    due_reminders_sent: reminderSent,
    timestamp: new Date().toISOString()
  }), { status: 200 })
})
