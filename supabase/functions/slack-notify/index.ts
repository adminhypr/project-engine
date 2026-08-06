// supabase/functions/slack-notify/index.ts
// Posts Dev Projects board activity to Slack via an Incoming Webhook.
// Deploy: npx supabase functions deploy slack-notify --no-verify-jwt
//   (or paste into the dashboard function editor — this file is self-contained)
//
// Invoked by pg_net from the migration-120/121 triggers with a thin payload:
//   { event, record, old?, actor }
// and by the pg_cron job `slack-eod-digest` with { event: "eod_digest", record: {} }.
// `record` is to_jsonb(NEW) of the source row; `actor` is auth.uid() at
// trigger time (null for service-role writers like dev-api → "A teammate").
// This function enriches (project / column / actor / assignee names) with
// the service role and formats one plain-English message per event.
//
// Required function secrets:
//   SLACK_WEBHOOK_URL      — hooks.slack.com incoming-webhook URL
//   WEBHOOK_SHARED_SECRET  — same shared secret as every other
//                            webhook/cron-driven function (post-081)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Inlined from _shared/security.ts (kept self-contained so the function
// can be deployed from the dashboard editor, which has no _shared folder).
// Strict policy: missing WEBHOOK_SHARED_SECRET env → reject (audit #10).
function verifyWebhookSecret(req: Request): boolean {
  const expected = Deno.env.get('WEBHOOK_SHARED_SECRET')
  if (!expected) {
    console.error('[security] WEBHOOK_SHARED_SECRET is not set — rejecting request.')
    return false
  }
  const got = req.headers.get('x-webhook-secret')
  if (!got || got.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const SLACK_WEBHOOK_URL = Deno.env.get('SLACK_WEBHOOK_URL')
const APP_URL = Deno.env.get('APP_URL') || 'https://tasks.hyprstaffing.com'

type Payload = {
  event: string
  record: Record<string, unknown>
  old?: Record<string, unknown>
  actor?: string | null
}

// Slack mrkdwn escaping — only &, <, > are special.
function esc(s: unknown): string {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function snippet(s: unknown, max = 140): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return `\n> ${esc(t.length > max ? t.slice(0, max) + '…' : t)}`
}

async function nameOf(table: string, id: unknown, col = 'name'): Promise<string | null> {
  if (!id) return null
  const { data } = await supabase.from(table).select(col).eq('id', id).maybeSingle()
  return (data as Record<string, string> | null)?.[col] ?? null
}

// First names read friendlier in chat ("John Ivan Eslabra" → "John Ivan"
// is ambiguous, so keep first two words max, trimming trailing role tags).
function friendly(full: string | null | undefined): string | null {
  if (!full) return null
  return full.split('|')[0].trim()
}

// HYPR profile full_name → Slack member id, for real @mentions.
// Matched with startsWith on the lowercased profile name, so "John Ivan …"
// hits 'john ivan' before 'ian' could ever match it.
const SLACK_IDS: Array<[string, string]> = [
  ['john ivan', 'U0BA14BAKMX'],
  ['ivan', 'U0BA14BAKMX'],
  ['rap', 'U0B9X73H7EJ'],
  ['ian', 'U0AH49E41V5'],
  ['theresa', 'U0BAE9PHNKB'],
]

// Render a person as a pinging Slack @mention when we know their Slack id,
// else fall back to their plain name. Use sparingly — mentions notify.
function mention(fullName: string | null | undefined): string | null {
  const name = friendly(fullName)
  if (!name) return null
  const lower = name.toLowerCase()
  for (const [key, id] of SLACK_IDS) {
    if (lower.startsWith(key)) return `<@${id}>`
  }
  return esc(name)
}

// Everyone assigned to a task, primary first. Falls back to assigned_to.
// pass ping=true to render real @mentions (notifies people — use sparingly).
async function assigneeNames(taskId: unknown, fallbackId?: unknown, ping = false): Promise<string> {
  if (!taskId) return 'no one yet'
  const { data } = await supabase
    .from('task_assignees')
    .select('is_primary, profile:profiles(full_name)')
    .eq('task_id', taskId)
  const rows = (data ?? []) as Array<{ is_primary: boolean; profile: { full_name: string } | null }>
  rows.sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
  const render = (n: string | null | undefined) => ping ? mention(n) : (friendly(n) ? esc(friendly(n)!) : null)
  const names = rows.map(r => render(r.profile?.full_name)).filter(Boolean) as string[]
  if (!names.length && fallbackId) {
    const fb = render(await nameOf('profiles', fallbackId, 'full_name'))
    if (fb) names.push(fb)
  }
  return names.length ? names.join(', ') : 'no one yet'
}

async function projectLink(projectId: unknown): Promise<string> {
  const name = esc((await nameOf('projects', projectId)) ?? 'a project')
  return projectId ? `<${APP_URL}/projects/${projectId}|${name}>` : name
}

// ── Per-event messages (plain English, assignees included) ────
async function buildMessage(p: Payload): Promise<string | null> {
  const r = p.record
  const actor = esc(friendly(p.actor ? await nameOf('profiles', p.actor, 'full_name') : null) ?? 'A teammate')

  switch (p.event) {
    case 'feature_created': {
      const proj = await projectLink(r.project_id)
      const who = await assigneeNames(r.id, r.assigned_to)
      const urg = r.urgency === 'High' || r.urgency === 'Urgent' ? ` It's marked *${esc(r.urgency)}*.` : ''
      return `🆕 *${proj}*: ${actor} added a new task — *“${esc(r.title)}”*, assigned to *${who}*.${urg}${snippet(r.notes)}`
    }
    case 'feature_moved': {
      const proj = await projectLink(r.project_id)
      const who = await assigneeNames(r.id, r.assigned_to)
      const to = String(r.status ?? '')
      const from = esc((await nameOf('project_columns', p.old?.project_column_id)) ?? p.old?.status ?? 'its old spot')
      switch (to) {
        case 'Done':
          return `✅ *${proj}*: ${actor} finished *“${esc(r.title)}”* — it's done! (worked on by *${who}*)`
        case 'In Progress':
          return `🚧 *${proj}*: ${actor} started working on *“${esc(r.title)}”*. (assigned to *${who}*)`
        case 'Blocked': {
          const pinged = await assigneeNames(r.id, r.assigned_to, true)
          return `⛔ *${proj}*: *“${esc(r.title)}”* is stuck — ${actor} flagged it as blocked. ${pinged}, can you take a look?`
        }
        default: {
          const toCol = esc((await nameOf('project_columns', r.project_column_id)) ?? to)
          return `📦 *${proj}*: ${actor} moved *“${esc(r.title)}”* from ${from} to *${toCol}*. (assigned to *${who}*)`
        }
      }
    }
    case 'assigned': {
      // record is a task_assignees row — resolve the task + new assignee.
      const { data: task } = await supabase
        .from('tasks').select('id, title, project_id')
        .eq('id', r.task_id as string).maybeSingle()
      if (!task?.project_id) return null
      const proj = await projectLink(task.project_id)
      const who = mention(await nameOf('profiles', r.profile_id, 'full_name')) ?? 'someone'
      return `👤 *${proj}*: ${actor} put ${who} on *“${esc(task.title)}”* — it's on your plate now!`
    }
    case 'bug_reported': {
      const proj = await projectLink(r.project_id)
      const sev = String(r.severity ?? 'Medium')
      const sevText = sev === 'Critical' || sev === 'High' ? ` This one's *${esc(sev)}* — needs attention soon.` : ''
      return `🐛 *${proj}*: ${actor} found a bug — *“${esc(r.title)}”*.${sevText}${snippet(r.description)}`
    }
    case 'request_created': {
      const proj = await projectLink(r.project_id)
      return `💡 *${proj}*: ${actor} suggested a new idea — *“${esc(r.title)}”*.${snippet(r.description)}`
    }
    case 'promotion': {
      const proj = await projectLink(r.project_id)
      const kind = p.old?.severity ? 'bug fix' : 'idea' // requests carry severity: null
      return `🚀 *${proj}*: ${actor} green-lit the ${kind} *“${esc(r.title)}”* — it's now a task on the board.`
    }
    case 'comment': {
      const { data: task } = await supabase
        .from('tasks').select('task_id, title, project_id')
        .eq('id', r.task_id as string).maybeSingle()
      if (!task?.project_id) return null
      const proj = await projectLink(task.project_id)
      return `💬 *${proj}*: ${actor} left a comment on *“${esc(task.title)}”*:${snippet(r.content)}`
    }
    case 'eod_digest':
      return await buildDigest()
    default:
      console.warn(`slack-notify: unknown event ${p.event}`)
      return null
  }
}

// ── EOD digest: everything that happened in the last 24h ─────
async function buildDigest(): Promise<string> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York',
  }).format(new Date())

  // Tasks marked Done in the window (audit log), still Done now.
  const { data: doneAudit } = await supabase
    .from('task_audit_log')
    .select('task_id')
    .eq('event_type', 'status_changed')
    .eq('new_value', 'Done')
    .gte('created_at', since)
  const doneIds = [...new Set((doneAudit ?? []).map(a => a.task_id))]
  const { data: doneTasks } = doneIds.length
    ? await supabase.from('tasks')
        .select('id, title, project_id, assigned_to')
        .in('id', doneIds).not('project_id', 'is', null).eq('status', 'Done')
    : { data: [] }

  const { data: newTasks } = await supabase
    .from('tasks').select('id, title, project_id, assigned_to')
    .not('project_id', 'is', null).gte('created_at', since)

  const { data: newBugs } = await supabase
    .from('bugs').select('id, title, severity, project_id').gte('created_at', since)

  const { data: newReqs } = await supabase
    .from('feature_requests').select('id, title, project_id').gte('created_at', since)

  // Comment count on project tasks.
  const { data: comments } = await supabase
    .from('comments').select('task_id').gte('created_at', since).not('task_id', 'is', null)
  const commentTaskIds = [...new Set((comments ?? []).map(c => c.task_id))]
  const { data: commentTasks } = commentTaskIds.length
    ? await supabase.from('tasks').select('id, project_id').in('id', commentTaskIds).not('project_id', 'is', null)
    : { data: [] }
  const projectTaskIds = new Set((commentTasks ?? []).map(t => t.id))
  const commentCount = (comments ?? []).filter(c => projectTaskIds.has(c.task_id)).length

  // Open tasks past their due date, across all projects.
  const { data: overdue } = await supabase
    .from('tasks').select('id, title, project_id, assigned_to, due_date')
    .not('project_id', 'is', null).neq('status', 'Done')
    .lt('due_date', new Date().toISOString())
    .order('due_date', { ascending: true }).limit(10)

  // Resolve project names once.
  const projIds = [...new Set([
    ...(doneTasks ?? []), ...(newTasks ?? []), ...(newBugs ?? []), ...(newReqs ?? []), ...(overdue ?? []),
  ].map(x => x.project_id).filter(Boolean))]
  const projNames = new Map<string, string>()
  if (projIds.length) {
    const { data } = await supabase.from('projects').select('id, name').in('id', projIds)
    for (const p of data ?? []) projNames.set(p.id, p.name)
  }
  const pn = (id: unknown) => esc(projNames.get(id as string) ?? 'a project')

  const taskLine = async (t: { title: string; project_id: unknown; assigned_to?: unknown; id?: unknown }) => {
    const who = await assigneeNames(t.id, t.assigned_to)
    return `• ${pn(t.project_id)} — “${esc(t.title)}” (${who})`
  }

  const sections: string[] = []
  if (doneTasks?.length) {
    const lines = await Promise.all(doneTasks.map(taskLine))
    sections.push(`*✅ Finished today (${doneTasks.length})*\n${lines.join('\n')}`)
  }
  if (newTasks?.length) {
    const lines = await Promise.all(newTasks.map(taskLine))
    sections.push(`*🆕 New tasks (${newTasks.length})*\n${lines.join('\n')}`)
  }
  if (newBugs?.length) {
    const lines = newBugs.map(b => `• ${pn(b.project_id)} — “${esc(b.title)}” (${esc(b.severity ?? 'Medium')})`)
    sections.push(`*🐛 New bugs (${newBugs.length})*\n${lines.join('\n')}`)
  }
  if (newReqs?.length) {
    const lines = newReqs.map(q => `• ${pn(q.project_id)} — “${esc(q.title)}”`)
    sections.push(`*💡 New ideas (${newReqs.length})*\n${lines.join('\n')}`)
  }
  if (commentCount) sections.push(`*💬 ${commentCount} comment${commentCount === 1 ? '' : 's'}* were posted across the boards.`)
  if (overdue?.length) {
    const lines = await Promise.all(overdue.map(async t => {
      const due = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })
        .format(new Date(String(t.due_date)))
      return `• ${pn(t.project_id)} — “${esc(t.title)}” (${await assigneeNames(t.id, t.assigned_to, true)}, was due ${due})`
    }))
    sections.push(`*⏰ Still overdue — needs a look*\n${lines.join('\n')}`)
  }

  const header = `*📋 Daily wrap-up — ${dateLabel}*`
  if (!sections.length) return `${header}\nA quiet day on the boards — no changes since yesterday. 🌙`
  return `${header}\n\n${sections.join('\n\n')}`
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
  if (!verifyWebhookSecret(req)) return new Response('unauthorized', { status: 401 })
  if (!SLACK_WEBHOOK_URL) {
    console.error('slack-notify: SLACK_WEBHOOK_URL secret is not set')
    return new Response('not configured', { status: 500 })
  }

  let payload: Payload
  try {
    payload = await req.json()
  } catch {
    return new Response('bad json', { status: 400 })
  }
  if (!payload?.event || !payload?.record) return new Response('bad payload', { status: 400 })

  let text: string | null
  try {
    text = await buildMessage(payload)
  } catch (e) {
    console.error(`slack-notify: failed to build message for ${payload.event}:`, e)
    return new Response('build failed', { status: 500 })
  }
  if (!text) return new Response('skipped', { status: 200 })

  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) {
    console.error(`slack-notify: Slack returned ${res.status}: ${await res.text()}`)
    return new Response('slack error', { status: 502 })
  }
  return new Response('ok', { status: 200 })
})
