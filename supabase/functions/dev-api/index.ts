// dev-api — API gateway for the `hypr` developer CLI.
//
// Auth: a per-dev personal access token (`hypr_…`) sent in the `x-hypr-key`
// header (or `Authorization: Bearer hypr_…`). We sha256 it and look it up in
// `api_keys` (migration 112) via the service role. The matched row's profile is
// the acting developer.
//
// Permission model: PROJECT MEMBERSHIP. A dev may read & work any task / request
// / bug in a project they belong to (`project_members`). Every project-scoped
// call checks membership explicitly before acting with the service role.
//
// Deploy: `supabase functions deploy dev-api --no-verify-jwt`
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both injected by Supabase).
//
// Gateway note (see migration 096): the Supabase edge gateway wants a valid
// `apikey` on the request; the CLI sends the public anon key for that, and the
// real dev token in `x-hypr-key`, so the two never collide.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Inlined CORS (no local imports) so this file is self-contained and can be
// pasted straight into the Supabase Dashboard if the CLI deploy is blocked.
const ALLOWED_ORIGINS = [
  'https://tasks.hyprstaffing.com',
  'https://project-engine-six.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
]
const VERCEL_PREVIEW_RE = /^https:\/\/project-engine-git-[\w-]+-admin-85372593s-projects\.vercel\.app$/
function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin')
  const allow = !origin
    ? ALLOWED_ORIGINS[0]
    : (ALLOWED_ORIGINS.includes(origin) || VERCEL_PREVIEW_RE.test(origin)) ? origin : ALLOWED_ORIGINS[0]
  return { 'Access-Control-Allow-Origin': allow, 'Vary': 'Origin' }
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } })

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function json(body: unknown, status: number, cors: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
}

async function isMember(dev: string, projectId: string): Promise<boolean> {
  const { data } = await admin
    .from('project_members').select('project_id')
    .eq('project_id', projectId).eq('profile_id', dev).maybeSingle()
  return !!data
}

// Resolve a task identifier that may be a uuid OR a human task_id ("T-AB12C3").
// task_id is globally unique (migration 001). Returns the row | null.
async function resolveTask(ident: string): Promise<{ id: string; project_id: string | null; parent_task_id: string | null } | null> {
  const col = /^[0-9a-fA-F-]{36}$/.test(ident) ? 'id' : 'task_id'
  const { data } = await admin.from('tasks').select('id, project_id, parent_task_id').eq(col, ident).maybeSingle()
  return data ?? null
}

const TASK_STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Done']
const TASK_URGENCIES = ['Low', 'Med', 'High', 'Urgent']
const BUG_SEVERITIES = ['Critical', 'High', 'Medium', 'Low']
const POS_STEP = 1000

// Mint a human task_id ("T-XXXXXX", 6 base36 chars) mixing time + randomness so
// concurrent creates don't collide. Mirrors src/lib/helpers.js generateTaskId
// shape (T- + 6 upper base36) but with entropy added.
function mintTaskId(): string {
  const s = (Date.now().toString(36) + Math.random().toString(36).slice(2)).toUpperCase()
  return 'T-' + s.slice(-6)
}

// Insert a task + its primary-assignee junction row, retrying the unique
// task_id on the rare 23505 collision. `markDone` seeds the assignee as already
// completed so the migration-044 aggregate keeps a Done task closed instead of
// reopening it. Returns { task } | { error }.
async function insertTask(opts: {
  dev: string
  title: string
  notes: string | null
  urgency: string
  dueDate: string | null
  status: string
  projectId: string | null
  columnId: string | null
  pos: number | null
  parentTaskId: string | null
  assignedTo: string
  teamId: string | null
  markDone: boolean
}): Promise<{ task?: Record<string, unknown>; error?: string }> {
  const nowIso = new Date().toISOString()
  let lastErr = 'insert failed'
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await admin.from('tasks').insert({
      task_id:           mintTaskId(),
      assigned_to:       opts.assignedTo,
      assigned_by:       opts.dev,
      assignment_type:   opts.assignedTo === opts.dev ? 'Self' : 'Peer',
      team_id:           opts.teamId,
      title:             opts.title,
      urgency:           opts.urgency,
      due_date:          opts.dueDate,
      notes:             opts.notes,
      date_assigned:     nowIso,
      status:            opts.status,
      parent_task_id:    opts.parentTaskId,
      project_id:        opts.projectId,
      project_column_id: opts.columnId,
      project_pos:       opts.pos,
    }).select('id, task_id, title, status').single()
    if (!error) {
      const assignee: Record<string, unknown> = { task_id: data.id, profile_id: opts.assignedTo, is_primary: true }
      if (opts.markDone) { assignee.completed_at = nowIso; assignee.completed_by = opts.assignedTo }
      const { error: aErr } = await admin.from('task_assignees').insert(assignee)
      if (aErr) return { error: aErr.message }
      return { task: data }
    }
    lastErr = error.message
    if (error.code !== '23505') break  // only retry on unique-violation (task_id race)
  }
  return { error: lastErr }
}

// Next bottom-of-column position for a new card in a column.
async function nextPos(columnId: string | null): Promise<number> {
  if (!columnId) return POS_STEP
  const { data } = await admin.from('tasks').select('project_pos').eq('project_column_id', columnId)
  const max = (data || []).reduce((mx, r) => Math.max(mx, Number(r.project_pos) || 0), 0)
  return max + POS_STEP
}

// Next bottom position for a lightweight lane (feature_requests / bugs).
async function nextLanePos(table: string, projectId: string): Promise<number> {
  const { data } = await admin.from(table).select('pos').eq('project_id', projectId)
  const max = (data || []).reduce((mx, r) => Math.max(mx, Number(r.pos) || 0), 0)
  return max + POS_STEP
}

// The team_id to stamp on a created task (the assignee's primary team).
async function teamOf(profileId: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('team_id').eq('id', profileId).maybeSingle()
  return data?.team_id ?? null
}

Deno.serve(async (req) => {
  const cors = { ...corsHeadersFor(req), 'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type, x-hypr-key' }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // ── authenticate the dev token ──────────────────────────────
  const rawHeader = req.headers.get('x-hypr-key') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const token = rawHeader && rawHeader.startsWith('hypr_') ? rawHeader : null
  if (!token) return json({ error: 'Missing API key (hypr_…)' }, 401, cors)

  const hash = await sha256hex(token)
  const { data: keyRow } = await admin
    .from('api_keys').select('id, profile_id, revoked_at').eq('key_hash', hash).maybeSingle()
  if (!keyRow || keyRow.revoked_at) return json({ error: 'Invalid or revoked API key' }, 401, cors)
  const dev = keyRow.profile_id as string
  admin.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id).then(() => {})

  // ── route ───────────────────────────────────────────────────
  const url = new URL(req.url)
  const seg = url.pathname.replace(/^\/functions\/v1/, '').replace(/^\/dev-api/, '').split('/').filter(Boolean)
  const m = req.method

  try {
    // Hard delete is intentionally unsupported — this API can archive, never
    // destroy. Reject every DELETE explicitly (defense-in-depth: there are also
    // no .delete() calls on tasks/requests/bugs anywhere below).
    if (m === 'DELETE') {
      return json({ error: 'Delete is not supported. Archive instead: POST /tasks/:id/archive' }, 405, cors)
    }

    // GET /  → who am I + quick help
    if (seg.length === 0) {
      const { data: me } = await admin.from('profiles').select('id, full_name, email, role').eq('id', dev).maybeSingle()
      return json({ ok: true, me, endpoints: ['GET /projects', 'GET /projects/:id/{tasks|requests|bugs}', 'POST /projects/:id/{tasks|requests|bugs}', 'GET /tasks/:id', 'PATCH /tasks/:id', 'PATCH /requests/:id', 'PATCH /bugs/:id', 'POST /tasks/:id/comments', 'POST /tasks/:id/claim', 'POST /tasks/:id/subtasks', 'POST /tasks/:id/{archive|unarchive}', 'POST /conversations/:id/messages'], note: 'No delete — archive only.' }, 200, cors)
    }

    // GET /projects → projects the dev belongs to (+ role + counts)
    if (seg[0] === 'projects' && seg.length === 1 && m === 'GET') {
      const { data: mem } = await admin.from('project_members').select('project_id, role').eq('profile_id', dev)
      const ids = (mem || []).map((r) => r.project_id)
      if (ids.length === 0) return json({ projects: [] }, 200, cors)
      const roleOf = new Map((mem || []).map((r) => [r.project_id, r.role]))
      const { data: projects } = await admin.from('projects').select('id, name, status, target_date').in('id', ids)
      const withRole = (projects || []).map((p) => ({ ...p, role: roleOf.get(p.id) }))
      return json({ projects: withRole }, 200, cors)
    }

    // /projects/:id/{tasks|requests|bugs}
    if (seg[0] === 'projects' && seg.length === 3 && m === 'GET') {
      const [, pid, lane] = seg
      if (!(await isMember(dev, pid))) return json({ error: 'Not a member of this project' }, 403, cors)
      if (lane === 'tasks') {
        const { data } = await admin.from('tasks')
          .select('id, task_id, title, status, urgency, due_date, assigned_to, project_column_id, project_pos')
          .eq('project_id', pid).order('project_pos')
        return json({ tasks: data || [] }, 200, cors)
      }
      if (lane === 'requests') {
        const { data } = await admin.from('feature_requests')
          .select('id, title, status, description').eq('project_id', pid).order('pos')
        return json({ requests: data || [] }, 200, cors)
      }
      if (lane === 'bugs') {
        const { data } = await admin.from('bugs')
          .select('id, title, status, severity, description').eq('project_id', pid).order('pos')
        return json({ bugs: data || [] }, 200, cors)
      }
      return json({ error: 'Unknown lane' }, 404, cors)
    }

    // POST /projects/:id/{tasks|requests|bugs}  → create in a lane
    if (seg[0] === 'projects' && seg.length === 3 && m === 'POST') {
      const [, pid, lane] = seg
      if (!(await isMember(dev, pid))) return json({ error: 'Not a member of this project' }, 403, cors)
      const body = await req.json().catch(() => ({}))
      const title = (body.title || '').trim()
      if (!title) return json({ error: 'title required' }, 400, cors)
      const description = (body.description || body.notes || '').trim() || null

      // Create a real Feature task (board card).
      if (lane === 'tasks') {
        const { data: cols } = await admin.from('project_columns')
          .select('id, maps_to_status, pos').eq('project_id', pid).order('pos')
        const columns = cols || []
        let status: string = TASK_STATUSES.includes(body.status) ? body.status : ''
        let columnId: string | null = null
        if (typeof body.column_id === 'string') {
          const c = columns.find((x) => x.id === body.column_id)
          if (!c) return json({ error: 'column_id is not a column of this project' }, 400, cors)
          columnId = c.id
          if (!status) status = TASK_STATUSES.includes(c.maps_to_status) ? c.maps_to_status : 'Not Started'
        } else {
          if (!status) status = 'Not Started'
          columnId = columns.find((c) => c.maps_to_status === status)?.id
            ?? columns.find((c) => c.maps_to_status === 'Not Started')?.id
            ?? columns[0]?.id ?? null
        }
        const urgency = TASK_URGENCIES.includes(body.urgency) ? body.urgency : 'Med'
        let assignedTo = dev
        if (typeof body.assignee_id === 'string' && body.assignee_id) {
          if (!(await isMember(body.assignee_id, pid))) return json({ error: 'assignee_id is not a member of this project' }, 400, cors)
          assignedTo = body.assignee_id
        }
        const res = await insertTask({
          dev, title, notes: description, urgency, dueDate: body.due_date || null, status,
          projectId: pid, columnId, pos: await nextPos(columnId), parentTaskId: null,
          assignedTo, teamId: await teamOf(assignedTo), markDone: status === 'Done',
        })
        if (res.error) return json({ error: res.error }, 400, cors)
        return json({ task: res.task }, 201, cors)
      }

      // Create a lightweight Feature Request.
      if (lane === 'requests') {
        const { data, error } = await admin.from('feature_requests')
          .insert({ project_id: pid, title, description, requester_id: dev, status: 'Requested', pos: await nextLanePos('feature_requests', pid) })
          .select('id, title, status, description').single()
        if (error) return json({ error: error.message }, 400, cors)
        return json({ request: data }, 201, cors)
      }

      // Create a lightweight Bug.
      if (lane === 'bugs') {
        const severity = BUG_SEVERITIES.includes(body.severity) ? body.severity : 'Medium'
        const { data, error } = await admin.from('bugs')
          .insert({ project_id: pid, title, description, reporter_id: dev, severity, status: 'Reported', pos: await nextLanePos('bugs', pid) })
          .select('id, title, status, severity, description').single()
        if (error) return json({ error: error.message }, 400, cors)
        return json({ bug: data }, 201, cors)
      }
      return json({ error: 'Unknown lane' }, 404, cors)
    }

    // /tasks/:id …  (:id may be a uuid or a human task_id like "T-AB12C3")
    if (seg[0] === 'tasks' && seg.length >= 2) {
      const resolved = await resolveTask(seg[1])
      if (!resolved) return json({ error: 'Task not found' }, 404, cors)
      const tid = resolved.id
      // Subtasks don't carry project_id (they mirror the app's assignTask path);
      // fall back to the parent's project for the membership check.
      let pid = resolved.project_id
      if (!pid && resolved.parent_task_id) {
        const { data: parent } = await admin.from('tasks').select('project_id').eq('id', resolved.parent_task_id).maybeSingle()
        pid = parent?.project_id ?? null
      }
      if (!pid) return json({ error: 'Task is not part of a project' }, 403, cors)
      if (!(await isMember(dev, pid))) return json({ error: 'Not a member of this task\'s project' }, 403, cors)

      // GET /tasks/:id  (+ assignees + comments)
      if (seg.length === 2 && m === 'GET') {
        const { data: task } = await admin.from('tasks')
          .select('id, task_id, title, status, urgency, due_date, notes, assigned_to, assigned_by, project_id, project_column_id')
          .eq('id', tid).maybeSingle()
        const { data: assignees } = await admin.from('task_assignees')
          // task_assignees has TWO FKs to profiles (profile_id + completed_by);
          // the embed must name the FK or PostgREST returns null (ambiguous).
          .select('profile_id, is_primary, completed_at, profile:profiles!task_assignees_profile_id_fkey(full_name)').eq('task_id', tid)
        const { data: comments } = await admin.from('comments')
          .select('id, content, created_at, author:profiles(full_name)').eq('task_id', tid).order('created_at')
        return json({ task, assignees: assignees || [], comments: comments || [] }, 200, cors)
      }

      // PATCH /tasks/:id  { status?, urgency?, due_date?, description? | notes?, title? }
      // A Dev Projects "card" is a task row; its card description lives in tasks.notes.
      if (seg.length === 2 && m === 'PATCH') {
        const body = await req.json().catch(() => ({}))
        const patch: Record<string, unknown> = {}
        if (typeof body.status === 'string') patch.status = body.status
        if (typeof body.urgency === 'string') patch.urgency = body.urgency
        if ('due_date' in body) patch.due_date = body.due_date || null
        if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim()
        // Card/task description is stored in `notes`; accept either key.
        if ('description' in body || 'notes' in body) {
          const desc = (body.description ?? body.notes)
          patch.notes = typeof desc === 'string' ? (desc.trim() || null) : null
        }
        if (Object.keys(patch).length === 0) return json({ error: 'Nothing to update' }, 400, cors)
        const { data, error } = await admin.from('tasks').update(patch).eq('id', tid).select('id, task_id, title, status, notes').single()
        if (error) return json({ error: error.message }, 400, cors)
        return json({ task: data }, 200, cors)
      }

      // GET /tasks/:id/comments
      if (seg.length === 3 && seg[2] === 'comments' && m === 'GET') {
        const { data } = await admin.from('comments')
          .select('id, content, created_at, author:profiles(full_name)').eq('task_id', tid).order('created_at')
        return json({ comments: data || [] }, 200, cors)
      }

      // POST /tasks/:id/comments  { content }
      if (seg.length === 3 && seg[2] === 'comments' && m === 'POST') {
        const body = await req.json().catch(() => ({}))
        const content = (body.content || '').trim()
        if (!content) return json({ error: 'content required' }, 400, cors)
        const { data, error } = await admin.from('comments')
          .insert({ task_id: tid, author_id: dev, content, mentioned_ids: [] })
          .select('id, content, created_at').single()
        if (error) return json({ error: error.message }, 400, cors)
        return json({ comment: data }, 201, cors)
      }

      // POST /tasks/:id/claim  → self-assign (idempotent)
      if (seg.length === 3 && seg[2] === 'claim' && m === 'POST') {
        const { data: existing } = await admin.from('task_assignees')
          .select('task_id').eq('task_id', tid).eq('profile_id', dev).maybeSingle()
        if (existing) return json({ ok: true, already: true }, 200, cors)
        const { error } = await admin.from('task_assignees').insert({ task_id: tid, profile_id: dev, is_primary: false })
        if (error) return json({ error: error.message }, 400, cors)
        return json({ ok: true, claimed: true }, 201, cors)
      }

      // POST /tasks/:id/archive  → personal archive (hides it from YOUR lists
      // only; collaborators still see it). Non-destructive, idempotent. This is
      // the sanctioned alternative to delete.
      if (seg.length === 3 && seg[2] === 'archive' && m === 'POST') {
        const { error } = await admin.from('task_archives')
          .upsert({ user_id: dev, task_id: tid }, { onConflict: 'user_id,task_id', ignoreDuplicates: true })
        if (error) return json({ error: error.message }, 400, cors)
        return json({ ok: true, archived: true }, 200, cors)
      }

      // POST /tasks/:id/unarchive  → undo a personal archive.
      if (seg.length === 3 && seg[2] === 'unarchive' && m === 'POST') {
        const { error } = await admin.from('task_archives')
          .delete().eq('user_id', dev).eq('task_id', tid)
        if (error) return json({ error: error.message }, 400, cors)
        return json({ ok: true, unarchived: true }, 200, cors)
      }

      // POST /tasks/:id/subtasks  → create a child task (single-level only).
      if (seg.length === 3 && seg[2] === 'subtasks' && m === 'POST') {
        if (resolved.parent_task_id) return json({ error: 'Cannot add a subtask to a subtask (single-level only)' }, 400, cors)
        const body = await req.json().catch(() => ({}))
        const title = (body.title || '').trim()
        if (!title) return json({ error: 'title required' }, 400, cors)
        const notes = (body.notes || body.description || '').trim() || null
        const urgency = TASK_URGENCIES.includes(body.urgency) ? body.urgency : 'Med'
        let assignedTo = dev
        if (typeof body.assignee_id === 'string' && body.assignee_id) {
          if (!(await isMember(body.assignee_id, pid))) return json({ error: 'assignee_id is not a member of this project' }, 400, cors)
          assignedTo = body.assignee_id
        }
        // Mirror the app: subtasks carry parent_task_id but no project_id/column,
        // so they stay off the board and inherit via the parent.
        const res = await insertTask({
          dev, title, notes, urgency, dueDate: body.due_date || null, status: 'Not Started',
          projectId: null, columnId: null, pos: null, parentTaskId: tid,
          assignedTo, teamId: await teamOf(assignedTo), markDone: false,
        })
        if (res.error) return json({ error: res.error }, 400, cors)
        return json({ subtask: res.task }, 201, cors)
      }
    }

    // PATCH /requests/:id  { description? | notes?, title? }
    // PATCH /bugs/:id       { description? | notes?, title?, severity? }
    // Lightweight backlog rows (uuid-keyed). Their card body is the `description`
    // column (not `notes` — that's tasks). Membership = the row's project.
    if ((seg[0] === 'requests' || seg[0] === 'bugs') && seg.length === 2 && m === 'PATCH') {
      const isReq = seg[0] === 'requests'
      const table = isReq ? 'feature_requests' : 'bugs'
      const noun = isReq ? 'request' : 'bug'
      const rid = seg[1]
      const { data: row } = await admin.from(table).select('id, project_id').eq('id', rid).maybeSingle()
      if (!row) return json({ error: `${noun[0].toUpperCase()}${noun.slice(1)} not found` }, 404, cors)
      if (!(await isMember(dev, row.project_id))) return json({ error: `Not a member of this ${noun}'s project` }, 403, cors)

      const body = await req.json().catch(() => ({}))
      const patch: Record<string, unknown> = {}
      if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim()
      if ('description' in body || 'notes' in body) {
        const desc = (body.description ?? body.notes)
        patch.description = typeof desc === 'string' ? (desc.trim() || null) : null
      }
      if (!isReq && typeof body.severity === 'string' && BUG_SEVERITIES.includes(body.severity)) patch.severity = body.severity
      if (Object.keys(patch).length === 0) return json({ error: 'Nothing to update' }, 400, cors)

      const sel = isReq ? 'id, title, status, description' : 'id, title, status, severity, description'
      const { data, error } = await admin.from(table).update(patch).eq('id', rid).select(sel).single()
      if (error) return json({ error: error.message }, 400, cors)
      return json(isReq ? { request: data } : { bug: data }, 200, cors)
    }

    // POST /conversations/:id/messages  → post a chat message as the key owner.
    // Gated by membership: hub campfires require hub membership; group/DM/task
    // conversations require being a participant. Content supports the app's
    // markdown subset (**bold**, lists, links, `code`, > quotes, @mentions).
    if (seg[0] === 'conversations' && seg.length === 3 && seg[2] === 'messages' && m === 'POST') {
      const cid = seg[1]
      const { data: convo } = await admin.from('conversations').select('id, kind, hub_id').eq('id', cid).maybeSingle()
      if (!convo) return json({ error: 'Conversation not found' }, 404, cors)

      let allowed = false
      if (convo.kind === 'hub' && convo.hub_id) {
        const { data: hm } = await admin.from('hub_members').select('hub_id').eq('hub_id', convo.hub_id).eq('profile_id', dev).maybeSingle()
        allowed = !!hm
      } else {
        const { data: cp } = await admin.from('conversation_participants').select('conversation_id').eq('conversation_id', cid).eq('user_id', dev).maybeSingle()
        allowed = !!cp
      }
      if (!allowed) return json({ error: 'You are not a member of this conversation' }, 403, cors)

      const body = await req.json().catch(() => ({}))
      const content = (body.content || '').trim()
      if (!content) return json({ error: 'content required' }, 400, cors)

      const { data, error } = await admin.from('dm_messages').insert({
        conversation_id: cid,
        author_id: dev,
        kind: 'user',
        content,
        mentions: [],
        inline_images: [],
        attachments: [],
      }).select('id, created_at').single()
      if (error) return json({ error: error.message }, 400, cors)
      return json({ message: data }, 201, cors)
    }

    return json({ error: 'Unknown route' }, 404, cors)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500, cors)
  }
})
