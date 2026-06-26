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
import { corsHeadersFor } from '../_shared/security.ts'

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
// task_id is globally unique (migration 001). Returns { id, project_id } | null.
async function resolveTask(ident: string): Promise<{ id: string; project_id: string | null } | null> {
  const col = /^[0-9a-fA-F-]{36}$/.test(ident) ? 'id' : 'task_id'
  const { data } = await admin.from('tasks').select('id, project_id').eq(col, ident).maybeSingle()
  return data ?? null
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
    // GET /  → who am I + quick help
    if (seg.length === 0) {
      const { data: me } = await admin.from('profiles').select('id, full_name, email, role').eq('id', dev).maybeSingle()
      return json({ ok: true, me, endpoints: ['GET /projects', 'GET /projects/:id/{tasks|requests|bugs}', 'GET /tasks/:id', 'PATCH /tasks/:id', 'POST /tasks/:id/comments', 'POST /tasks/:id/claim'] }, 200, cors)
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

    // /tasks/:id …  (:id may be a uuid or a human task_id like "T-AB12C3")
    if (seg[0] === 'tasks' && seg.length >= 2) {
      const resolved = await resolveTask(seg[1])
      if (!resolved) return json({ error: 'Task not found' }, 404, cors)
      const tid = resolved.id
      const pid = resolved.project_id
      if (!pid) return json({ error: 'Task is not part of a project' }, 403, cors)
      if (!(await isMember(dev, pid))) return json({ error: 'Not a member of this task\'s project' }, 403, cors)

      // GET /tasks/:id  (+ assignees + comments)
      if (seg.length === 2 && m === 'GET') {
        const { data: task } = await admin.from('tasks')
          .select('id, task_id, title, status, urgency, due_date, notes, assigned_to, assigned_by, project_id, project_column_id')
          .eq('id', tid).maybeSingle()
        const { data: assignees } = await admin.from('task_assignees')
          .select('profile_id, is_primary, completed_at, profile:profiles(full_name)').eq('task_id', tid)
        const { data: comments } = await admin.from('comments')
          .select('id, content, created_at, author:profiles(full_name)').eq('task_id', tid).order('created_at')
        return json({ task, assignees: assignees || [], comments: comments || [] }, 200, cors)
      }

      // PATCH /tasks/:id  { status?, urgency?, due_date? }
      if (seg.length === 2 && m === 'PATCH') {
        const body = await req.json().catch(() => ({}))
        const patch: Record<string, unknown> = {}
        if (typeof body.status === 'string') patch.status = body.status
        if (typeof body.urgency === 'string') patch.urgency = body.urgency
        if ('due_date' in body) patch.due_date = body.due_date || null
        if (Object.keys(patch).length === 0) return json({ error: 'Nothing to update' }, 400, cors)
        const { data, error } = await admin.from('tasks').update(patch).eq('id', tid).select('id, task_id, title, status').single()
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
    }

    return json({ error: 'Unknown route' }, 404, cors)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500, cors)
  }
})
