// supabase/functions/send-alerts/index.ts
// Deploy: npx supabase functions deploy send-alerts
// Set secret: npx supabase secrets set RESEND_API_KEY=re_xxxxx
// Schedule: npx supabase functions schedule send-alerts --cron "0 */4 * * *"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM_EMAIL = Deno.env.get('ALERT_FROM_EMAIL') || 'alerts@hyprassistants.com'

function getPriority(task: any): string {
  const now = new Date()
  if (task.due_date) {
    const due  = new Date(task.due_date)
    const diff = due.getTime() - now.getTime()
    const hrs  = diff / 36e5
    if (diff < 0)  return 'red'
    if (hrs < 12)  return 'orange'
    if (hrs < 24)  return 'yellow'
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

async function sendEmail(to: string[], cc: string[], subject: string, text: string, html: string) {
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
      from: FROM_EMAIL,
      to,
      cc: cc.length ? cc : undefined,
      subject,
      text,
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

Deno.serve(async () => {
  if (!RESEND_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
      { status: 500 }
    )
  }

  const { data: tasks } = await supabase
    .from('tasks')
    .select(`
      *,
      assignee:profiles!tasks_assigned_to_fkey(full_name, email, team_id),
      assigner:profiles!tasks_assigned_by_fkey(full_name),
      team:teams(name)
    `)
    .eq('email_alert_sent', false)
    .neq('status', 'Done')

  if (!tasks?.length) {
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 })
  }

  const redTasks = tasks.filter(t => getPriority(t) === 'red')
  let sent = 0

  for (const task of redTasks) {
    const toEmail = task.assignee?.email
    if (!toEmail) continue

    // Get manager email
    let managerEmail: string | null = null
    if (task.assignee?.team_id) {
      const { data: mgr } = await supabase
        .from('profiles')
        .select('email')
        .eq('team_id', task.assignee.team_id)
        .in('role', ['Manager', 'Admin'])
        .neq('id', task.assigned_to)
        .limit(1)
        .single()
      if (mgr) managerEmail = mgr.email
    }

    const flag = task.assignment_type === 'Peer' || task.assignment_type === 'CrossTeam'
      ? ' [Peer-assigned]'
      : task.assignment_type === 'Upward' ? ' [Upward-assigned]' : ''

    const reason = task.due_date && new Date(task.due_date) < new Date()
      ? `Overdue since ${new Date(task.due_date).toLocaleDateString()}`
      : 'No update for >36 hours'

    const subject = `🔴 RED Alert${flag}: "${task.title}" — Action Required`

    const text = [
      `Hello ${task.assignee?.full_name},`,
      '',
      'This is an automated priority alert from Project Engine.',
      '',
      `Task ID     : ${task.task_id}`,
      `Task        : ${task.title}`,
      `Urgency     : ${task.urgency}`,
      `Assigned By : ${task.assigner?.full_name} (${task.assignment_type})`,
      `For         : ${task.who_due_to || '—'}`,
      `Status      : 🔴 RED — ${reason}`,
      '',
      'Please action this immediately.',
      '',
      '— Project Engine',
    ].join('\n')

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto;">
        <div style="background: #1a2744; color: white; padding: 16px 24px; border-radius: 12px 12px 0 0;">
          <h2 style="margin: 0; font-size: 16px;">🔴 RED Alert${flag}</h2>
        </div>
        <div style="background: #fff; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <p>Hello <strong>${task.assignee?.full_name}</strong>,</p>
          <p>A task requires your immediate attention:</p>
          <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #6b7a9e;">Task ID</td><td style="padding: 6px 0; font-weight: 600;">${task.task_id}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7a9e;">Task</td><td style="padding: 6px 0; font-weight: 600;">${task.title}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7a9e;">Urgency</td><td style="padding: 6px 0;">${task.urgency}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7a9e;">Assigned By</td><td style="padding: 6px 0;">${task.assigner?.full_name} (${task.assignment_type})</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7a9e;">For</td><td style="padding: 6px 0;">${task.who_due_to || '—'}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7a9e;">Status</td><td style="padding: 6px 0; color: #ef4444; font-weight: 700;">🔴 RED — ${reason}</td></tr>
          </table>
          <div style="margin-top: 20px; padding: 12px; background: #fef2f2; border-radius: 8px; text-align: center;">
            <strong style="color: #991b1b;">Please action this immediately.</strong>
          </div>
          <p style="margin-top: 20px; font-size: 12px; color: #9ca3af;">— Project Engine</p>
        </div>
      </div>
    `

    const cc = managerEmail && managerEmail !== toEmail ? [managerEmail] : []
    const ok = await sendEmail([toEmail], cc, subject, text, html)

    if (ok) {
      await supabase.from('tasks').update({ email_alert_sent: true }).eq('id', task.id)
      sent++
    }
  }

  return new Response(JSON.stringify({ sent, checked: tasks.length, red: redTasks.length }), { status: 200 })
})
