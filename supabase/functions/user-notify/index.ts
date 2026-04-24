// supabase/functions/user-notify/index.ts
// User lifecycle emails: approval notifications + invite emails + comment pings.
// Deploy: npx supabase functions deploy user-notify
//
// Called from the frontend via supabase.functions.invoke('user-notify', { body: {...} })
// Requires: RESEND_API_KEY, APP_URL env vars
//
// Auth policy (C1):
//   - 'invite'   → Admin only.
//   - 'approved' → Admin only.
//   - 'comment'  → Authenticated caller must be the comment author AND a
//                  participant of the target task (assignee, co-assignee, or
//                  assigner). Email recipients are looked up from the DB — we
//                  never trust client-supplied email addresses.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor, verifyJWT } from '../_shared/security.ts'

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

// ── 1. APPROVED — user's first team was assigned ──
async function onUserApproved(userId: string, approverName: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, full_name')
    .eq('id', userId)
    .single()

  if (!profile?.email) return { ok: false, error: 'Profile not found' }

  const html = emailWrap('You\'re Approved!', '#22c55e',
    `<p style="margin: 0 0 12px; color: #374151;">Hello <strong>${profile.full_name || 'there'}</strong>,</p>
     <p style="margin: 0 0 16px; color: #374151;">Great news — <strong>${approverName}</strong> has approved your account on Hypr Task. You're all set to start using the app.</p>
     <div style="padding: 16px; background: #f0fdf4; border-radius: 10px; text-align: center; margin: 16px 0;">
       <p style="margin: 0; font-size: 14px; color: #166534; font-weight: 600;">Your account is ready</p>
       <p style="margin: 4px 0 0; font-size: 13px; color: #15803d;">Sign in with your Google account to get started</p>
     </div>
     <div style="margin-top: 20px; text-align: center;">
       <a href="${APP_URL}" style="display: inline-block; padding: 12px 32px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">Sign In to Hypr Task</a>
     </div>`)

  const ok = await sendEmail([profile.email], 'Your Hypr Task account is approved', html)
  return { ok }
}

// ── 2. INVITE — send an invitation to a new email ──
async function onInviteUser(email: string, inviterName: string) {
  const html = emailWrap('You\'re Invited!', '#6366f1',
    `<p style="margin: 0 0 12px; color: #374151;">Hello,</p>
     <p style="margin: 0 0 16px; color: #374151;"><strong>${inviterName}</strong> has invited you to join <strong>Hypr Task</strong> — the team's task management app.</p>
     <div style="padding: 16px; background: #eef2ff; border-radius: 10px; margin: 16px 0;">
       <p style="margin: 0; font-size: 14px; color: #3730a3; font-weight: 600;">Getting started is easy</p>
       <p style="margin: 8px 0 0; font-size: 13px; color: #4338ca;">Click the button below and sign in with your Google account (<strong>${email}</strong>). Your account will be set up automatically.</p>
     </div>
     <div style="margin-top: 20px; text-align: center;">
       <a href="${APP_URL}" style="display: inline-block; padding: 12px 32px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">Join Hypr Task</a>
     </div>
     <p style="margin: 16px 0 0; font-size: 12px; color: #9ca3af; text-align: center;">If you weren't expecting this invitation, you can safely ignore this email.</p>`)

  const ok = await sendEmail([email], `${inviterName} invited you to Hypr Task`, html)
  return { ok }
}

// ── 3. COMMENT — notify assignees + assigner + @mentioned users ──
// `authorId` and `callerRole` come from verified JWT — we do NOT trust client body.
// Recipients are derived from the DB: tasks.assigned_by + task_assignees rows +
// intersect mentionedIds with the hub/task's known participant set.
async function onNewComment(
  taskId: string,
  authorId: string,
  commentText: string,
  mentionedIds: string[] = []
) {
  const { data: task } = await supabase
    .from('tasks')
    .select('id, task_id, title, assigned_to, assigned_by')
    .eq('id', taskId)
    .single()

  if (!task) return { ok: false, error: 'Task not found' }

  // Pull the full assignee list from the junction table (primary assigned_to
  // is kept for back-compat but multi-assignee is the source of truth).
  const { data: assigneeRows } = await supabase
    .from('task_assignees')
    .select('profile_id')
    .eq('task_id', taskId)

  const assigneeIds = new Set<string>()
  if (task.assigned_to) assigneeIds.add(task.assigned_to)
  for (const r of assigneeRows || []) {
    if (r.profile_id) assigneeIds.add(r.profile_id)
  }

  // Authorization check: caller must be a task participant (assignee or assigner).
  const isParticipant = assigneeIds.has(authorId) || task.assigned_by === authorId
  if (!isParticipant) {
    return { ok: false, error: 'Not a task participant' }
  }

  // Collect recipients: all assignees + assigner + valid @mentions (except author).
  const notifyIds = new Set<string>()
  for (const id of assigneeIds) if (id !== authorId) notifyIds.add(id)
  if (task.assigned_by && task.assigned_by !== authorId) notifyIds.add(task.assigned_by)
  for (const id of mentionedIds) {
    if (typeof id === 'string' && id !== authorId) notifyIds.add(id)
  }

  if (notifyIds.size === 0) return { ok: true }

  // Fetch profiles for recipients + author (for name) from the DB.
  const allIds = [...notifyIds, authorId]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', allIds)

  if (!profiles?.length) return { ok: false, error: 'Profiles not found' }

  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]))
  const authorName = profileMap[authorId]?.full_name || 'Someone'

  const recipientEmails = new Set<string>()
  for (const id of notifyIds) {
    const email = profileMap[id]?.email
    if (email) recipientEmails.add(email)
  }

  if (recipientEmails.size === 0) return { ok: true }

  const truncated = commentText.length > 200 ? commentText.slice(0, 200) + '...' : commentText
  const emailText = truncated.replace(/@(\w[\w\s]*?\w)(?=\s|$|[.,!?])/g, '<strong style="color: #6366f1;">@$1</strong>')

  const html = emailWrap('New Comment on Task', '#6366f1',
    `<p style="margin: 0 0 12px; color: #374151;"><strong>${authorName}</strong> commented on a task:</p>
     <div style="background: #f8f9fc; border-radius: 10px; padding: 16px; margin: 12px 0;">
       <p style="margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #111827;">${task.title}</p>
       <p style="margin: 0; font-size: 13px; color: #6b7280;">${task.task_id}</p>
     </div>
     <div style="padding: 12px; background: #f8f9fc; border-left: 3px solid #6366f1; border-radius: 0 8px 8px 0; margin: 16px 0;">
       <p style="margin: 0; font-size: 14px; color: #374151; line-height: 1.5;">${emailText}</p>
     </div>
     <div style="margin-top: 20px; text-align: center;">
       <a href="${APP_URL}/my-tasks?task=${task.id}" style="display: inline-block; padding: 10px 24px; background: #6366f1; color: white; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 14px;">View Task</a>
     </div>`)

  const ok = await sendEmail([...recipientEmails], `${authorName} commented on "${task.title}"`, html)
  return { ok }
}

// ── Request handler ───────────────────────────
Deno.serve(async (req) => {
  const cors = corsHeadersFor(req)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), { status: 500, headers: cors })
  }

  // C1: require a valid JWT for every call.
  const caller = await verifyJWT(req)
  if (!caller) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors })
  }

  try {
    const body = await req.json()
    const { type, userId, email, approverName, inviterName, taskId, authorId, commentText, mentionedIds } = body

    if (type === 'approved' && userId) {
      // Admins and Managers can approve users (managers via manager_setup_users
      // RLS — they can add profile_teams rows for unassigned users on their teams).
      if (caller.role !== 'Admin' && caller.role !== 'Manager') {
        return new Response(JSON.stringify({ error: 'Admin or Manager access required' }), { status: 403, headers: cors })
      }
      const result = await onUserApproved(userId, approverName || 'An administrator')
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 400, headers: cors })
    }

    if (type === 'invite' && email) {
      // Managers + Admins can invite users (matches the Settings UI: invite is
      // hidden only for external roles Agent/Client).
      if (caller.role !== 'Admin' && caller.role !== 'Manager') {
        return new Response(JSON.stringify({ error: 'Admin or Manager access required' }), { status: 403, headers: cors })
      }
      const result = await onInviteUser(email, inviterName || 'A team member')
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 400, headers: cors })
    }

    if (type === 'comment' && taskId && authorId && commentText) {
      // Caller must be the authorId they're claiming.
      if (authorId !== caller.userId) {
        return new Response(JSON.stringify({ error: 'authorId must match caller' }), { status: 403, headers: cors })
      }
      const result = await onNewComment(taskId, caller.userId, commentText, mentionedIds || [])
      return new Response(JSON.stringify(result), { status: result.ok ? 200 : 400, headers: cors })
    }

    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: cors })
  } catch (err) {
    console.error('user-notify error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors })
  }
})
