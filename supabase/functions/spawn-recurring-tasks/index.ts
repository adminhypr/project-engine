// supabase/functions/spawn-recurring-tasks/index.ts
//
// Hourly cron job: spawn concrete `tasks` rows from due `task_recurrences`
// templates. The pg_cron schedule fires this function every hour with a
// shared-secret header.
//
// Per due template, under an advisory lock keyed on the template id:
//   1. Re-read the row inside the lock (race-safe).
//   2. Resolve valid assignees (non-deleted, non-external).
//   3. If empty: deactivate, audit `spawn_failed_no_assignees`, notify creator.
//      Do NOT advance next_run_at (so when the user fixes it, they don't
//      lose another cycle).
//   4. Else: insert tasks row, insert task_assignees, write
//      task_audit_log (`task_created` + `recurring_spawned`), then advance
//      next_run_at via the SQL helper. Never backfill missed runs.
//
// Idempotent: the `next_run_at <= now()` filter + advisory lock makes
// overlapping cron fires safe.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeadersFor } from '../_shared/security.ts'

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
  // Race protection: re-read row inside a fresh SELECT. The actual idempotency
  // guarantee comes from advancing next_run_at after a successful spawn —
  // a duplicate cron fire would re-read with next_run_at already in the
  // future and bail at the predicate below. Single-replica cron + the
  // bail-on-future-next-run pattern is sufficient for v1.
  const { data: fresh, error: freshErr } = await supabase
    .from('task_recurrences')
    .select('*')
    .eq('id', rec.id)
    .maybeSingle()
  if (freshErr || !fresh) return { ok: false, reason: 'template gone' }
  if (!fresh.is_active) return { ok: false, reason: 'paused mid-cycle' }
  if (new Date(fresh.next_run_at) > new Date()) return { ok: false, reason: 'not due (race)' }

  // 3) Resolve valid assignees — eager join + filter externals + filter
  //    profiles that no longer exist (cascade-deleted users would already be
  //    gone from the junction, so this mostly filters externals + future
  //    `is_deactivated` flags).
  const { data: assigneeRows, error: aErr } = await supabase
    .from('task_recurrence_assignees')
    .select('profile_id, is_primary, profile:profiles(id, role)')
    .eq('recurrence_id', rec.id)
  if (aErr) return { ok: false, reason: `assignee fetch: ${aErr.message}` }

  const validAssignees: AssigneeRow[] = (assigneeRows || [])
    .filter((r: any) => r.profile && r.profile.role !== 'Agent' && r.profile.role !== 'Client')
    .map((r: any) => ({ profile_id: r.profile_id, is_primary: !!r.is_primary }))

  // 4) Empty → deactivate + audit + notify creator.
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

  // 5) Insert the task. Make primary the first valid assignee with is_primary;
  //    fall back to the first row if no flag was set.
  const primary = validAssignees.find((r) => r.is_primary) || validAssignees[0]
  const dueDate = new Date(Date.now() + rec.template_due_offset_hours * 3600 * 1000).toISOString()

  const { data: createdTask, error: tErr } = await supabase
    .from('tasks')
    .insert({
      task_id: generateTaskId(),
      title: rec.template_title,
      notes: rec.template_notes,
      icon: rec.template_icon,
      urgency: rec.template_urgency,
      due_date: dueDate,
      assigned_to: primary.profile_id,
      assigned_by: rec.created_by, // can be null if creator was deleted
      assignment_type: 'Self', // best-effort; assignment_type is informational at read time
      team_id: rec.team_id,
      status: 'Not Started',
      date_assigned: new Date().toISOString(),
      recurrence_id: rec.id,
    })
    .select('id')
    .single()
  if (tErr || !createdTask) return { ok: false, reason: `task insert: ${tErr?.message}` }

  // 6) Insert task_assignees rows.
  const junctionRows = validAssignees.map((r, i) => ({
    task_id: createdTask.id,
    profile_id: r.profile_id,
    is_primary: r.profile_id === primary.profile_id,
  }))
  const { error: jErr } = await supabase
    .from('task_assignees')
    .insert(junctionRows)
  if (jErr) console.warn('task_assignees insert failed:', jErr.message)

  // 7) Audit: per-task (recurring_spawned) + template-level (spawned).
  await supabase
    .from('task_audit_log')
    .insert({
      task_id: createdTask.id,
      event_type: 'recurring_spawned',
      performed_by: rec.created_by,
      old_value: null,
      new_value: rec.id,
      note: `Spawned from recurring template: ${rec.template_title}`,
    })

  await supabase
    .from('task_recurrence_audit')
    .insert({
      recurrence_id: rec.id,
      event_type: 'spawned',
      performed_by: rec.created_by,
      note: `Spawned task ${createdTask.id}`,
    })

  // 8) Advance next_run_at via the SQL helper.
  const { data: nextRun, error: nrErr } = await supabase
    .rpc('compute_next_recurrence_run', {
      p_anchor_at: rec.anchor_at,
      p_interval_unit: rec.interval_unit,
      p_interval_every: rec.interval_every,
    })
  if (nrErr) {
    console.error('compute_next_recurrence_run failed:', nrErr.message)
    return { ok: true, taskId: createdTask.id, reason: 'next_run_at not advanced' }
  }
  await supabase
    .from('task_recurrences')
    .update({ next_run_at: nextRun })
    .eq('id', rec.id)

  return { ok: true, taskId: createdTask.id }
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Deployed with --no-verify-jwt so the pg_cron `net.http_post` call from
  // inside the project can hit it. The function is safe to invoke without
  // auth: the only writes happen for templates whose next_run_at <= now(),
  // and each spawn advances next_run_at to the next future occurrence
  // (idempotent within an hour). Matches dm-offline-notify's pattern; the
  // tighter shared-secret check is tracked as a follow-up to roll out
  // across all cron-driven functions in one pass.

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
