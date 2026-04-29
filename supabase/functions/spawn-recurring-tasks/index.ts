// supabase/functions/spawn-recurring-tasks/index.ts
//
// Hourly cron job: spawn concrete `tasks` rows from due `task_recurrences`
// templates. The pg_cron schedule fires this function every hour with a
// shared-secret header.
//
// Per due template:
//   1. Resolve valid assignees (non-deleted, non-external).
//   2. If empty: deactivate, audit `spawn_failed_no_assignees`, notify creator.
//      Do NOT advance next_run_at (so when the user fixes it, they don't
//      lose another cycle).
//   3. Else: hand off to the public.spawn_recurrence() RPC, which inside a
//      single transaction takes a per-template advisory lock, re-checks
//      due-state, inserts the task + task_assignees + both audit rows, and
//      advances next_run_at. Migration 079.
//
// Idempotent: pg_try_advisory_xact_lock + the in-RPC re-check of
// next_run_at make overlapping cron fires safe.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor, verifyWebhookSecret } from '../_shared/security.ts'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

interface RecurrenceRow {
  id: string
  template_title: string
  template_notes: string | null
  template_icon: string | null
  template_urgency: string
  template_due_offset_hours: number
  team_id: string | null
  interval_unit: 'day' | 'week' | 'month'
  interval_every: number
  anchor_at: string
  next_run_at: string
  created_by: string | null
  is_active: boolean
}

interface AssigneeRow {
  profile_id: string
  is_primary: boolean
}

// Generate a human-readable task_id (mirrors src/lib/helpers.js generateTaskId).
function generateTaskId(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `T-${ts}-${rand}`
}

async function spawnOne(rec: RecurrenceRow): Promise<{ ok: boolean; reason?: string; taskId?: string }> {
  // 1) Resolve valid assignees — eager join + filter externals + filter
  //    profiles that no longer exist (cascade-deleted users would already be
  //    gone from the junction, so this mostly filters externals + future
  //    `is_deactivated` flags).
  //
  //    This stays in the edge function (rather than moving into the RPC)
  //    because the empty-assignees branch needs to call the notify edge
  //    function — something the SQL function can't do directly.
  const { data: assigneeRows, error: aErr } = await supabase
    .from('task_recurrence_assignees')
    .select('profile_id, is_primary, profile:profiles(id, role)')
    .eq('recurrence_id', rec.id)
  if (aErr) return { ok: false, reason: `assignee fetch: ${aErr.message}` }

  const validAssignees: AssigneeRow[] = (assigneeRows || [])
    .filter((r: any) => r.profile && r.profile.role !== 'Agent' && r.profile.role !== 'Client')
    .map((r: any) => ({ profile_id: r.profile_id, is_primary: !!r.is_primary }))

  // 2) Empty → deactivate + audit + notify creator. (Pre-spawn step;
  //    not part of the atomic RPC.)
  if (validAssignees.length === 0) {
    await supabase
      .from('task_recurrences')
      .update({ is_active: false })
      .eq('id', rec.id)

    await supabase
      .from('task_recurrence_audit')
      .insert({
        recurrence_id: rec.id,
        event_type: 'spawn_failed_no_assignees',
        performed_by: null,
        note: `Template "${rec.template_title}" had no valid assignees at spawn time.`,
      })

    // Best-effort: ping the notify edge function. If it fails, just log.
    try {
      const notifyUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/notify`
      await fetch(notifyUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
          'X-Webhook-Secret': Deno.env.get('WEBHOOK_SHARED_SECRET') ?? '',
        },
        body: JSON.stringify({
          type: 'recurring_spawn_failed',
          recurrence_id: rec.id,
          template_title: rec.template_title,
          creator_id: rec.created_by,
        }),
      })
    } catch (e) {
      console.warn('notify call failed:', e)
    }

    return { ok: false, reason: 'no valid assignees — deactivated' }
  }

  // 3) Atomic spawn: one RPC takes the per-template advisory lock,
  //    re-checks is_active + next_run_at FOR UPDATE, inserts the task
  //    + task_assignees + both audit rows, and advances next_run_at.
  //    Migration 079.
  const dueDate = new Date(Date.now() + rec.template_due_offset_hours * 3600 * 1000).toISOString()
  const taskIdStr = generateTaskId()

  const { data: spawnedId, error: spawnErr } = await supabase.rpc('spawn_recurrence', {
    p_recurrence_id: rec.id,
    p_task_id_str: taskIdStr,
    p_due_date: dueDate,
    p_assignees: validAssignees.map((a) => ({
      profile_id: a.profile_id,
      is_primary: a.is_primary,
    })),
    p_creator: rec.created_by,
  })

  if (spawnErr) return { ok: false, reason: `spawn rpc: ${spawnErr.message}` }
  if (!spawnedId) return { ok: false, reason: 'locked or not due' }

  return { ok: true, taskId: spawnedId as string }
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Deployed with --no-verify-jwt so the pg_cron `net.http_post` call from
  // inside the project can hit it. Auth is enforced via the X-Webhook-Secret
  // header — pg_cron sends it (migration 081) and verifyWebhookSecret
  // constant-time compares against the WEBHOOK_SHARED_SECRET env var.
  if (!verifyWebhookSecret(req)) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: cors })
  }

  const startedAt = Date.now()
  const results: Array<{ id: string; result: any }> = []

  try {
    // Pull due templates. Cap at 200 per run as a safety net (pg_cron fires
    // hourly; if 200 templates are due in the same hour we have bigger
    // issues).
    const { data: due, error } = await supabase
      .from('task_recurrences')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_at', new Date().toISOString())
      .limit(200)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: cors })
    }

    for (const rec of (due || [])) {
      const r = await spawnOne(rec as RecurrenceRow)
      results.push({ id: rec.id, result: r })
    }

    return new Response(
      JSON.stringify({
        ok: true,
        elapsed_ms: Date.now() - startedAt,
        considered: (due || []).length,
        results,
      }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('spawn-recurring-tasks error:', err)
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: cors })
  }
})
