import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const TEMPLATE_SELECT = `
  *,
  team:teams(id, name),
  creator:profiles!task_recurrences_created_by_fkey(id, full_name, avatar_url),
  task_recurrence_assignees(profile_id, is_primary, profile:profiles(id, full_name, avatar_url))
`

// CRUD + realtime for recurring task templates the caller can see (RLS
// scopes to admin / creator / manager-of-team / assignee).
export function useRecurrences() {
  const { profile } = useAuth()
  const [templates, setTemplates] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)
  const profileIdRef = useRef(profile?.id)
  profileIdRef.current = profile?.id

  const fetchAll = useCallback(async () => {
    if (!profileIdRef.current) return
    setError(null)
    const { data, error } = await supabase
      .from('task_recurrences')
      .select(TEMPLATE_SELECT)
      .order('created_at', { ascending: false })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    const enriched = (data || []).map(row => ({
      ...row,
      assignees: (row.task_recurrence_assignees || []).map(a => ({
        id:         a.profile?.id || a.profile_id,
        full_name:  a.profile?.full_name,
        avatar_url: a.profile?.avatar_url,
        is_primary: a.is_primary,
      })),
    }))
    setTemplates(enriched)
    setLoading(false)
  }, [])

  // Initial fetch + refetch when the user's profile is ready.
  useEffect(() => { fetchAll() }, [profile?.id, fetchAll])

  // Mirror current templates so the realtime handler can answer
  // "is this row in my visible list?" without re-subscribing.
  const templatesRef = useRef([])
  useEffect(() => { templatesRef.current = templates }, [templates])

  // Realtime — coalesce bursts and only refetch when the changing row
  // actually affects the current viewer. Without this, the spawn-recurring
  // cron + any other user's edits caused a full template list refetch on
  // every event the viewer had RLS access to (i.e. all templates for an
  // admin), which churned every consumer (MyTasksPage, AssignTaskPage,
  // RecurringList) unnecessarily.
  useEffect(() => {
    if (!profile?.id) return
    let timer = null
    function scheduleRefetch() {
      if (timer) return
      timer = setTimeout(() => { timer = null; fetchAll() }, 250)
    }
    function isRelevantTemplateChange(payload) {
      const me = profileIdRef.current
      const newRow = payload.new
      const oldRow = payload.old
      const row = newRow || oldRow
      if (!row) return false
      if (newRow?.created_by === me || oldRow?.created_by === me) return true
      return templatesRef.current.some(t => t.id === row.id)
    }
    function isRelevantAssigneeChange(payload) {
      const me = profileIdRef.current
      const newRow = payload.new
      const oldRow = payload.old
      const row = newRow || oldRow
      if (!row) return false
      if (newRow?.profile_id === me || oldRow?.profile_id === me) return true
      return templatesRef.current.some(t => t.id === row.recurrence_id)
    }

    const ch = supabase
      .channel('task-recurrences-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_recurrences' },
        (payload) => { if (isRelevantTemplateChange(payload)) scheduleRefetch() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_recurrence_assignees' },
        (payload) => { if (isRelevantAssigneeChange(payload)) scheduleRefetch() })
      .subscribe()
    return () => {
      if (timer) { clearTimeout(timer); timer = null }
      supabase.removeChannel(ch)
    }
  }, [profile?.id, fetchAll])

  const createTemplate = useCallback(async (draft) => {
    if (!profile?.id) return { ok: false, msg: 'not authed' }

    // Initial next_run_at:
    //   • If anchor is in the future, next_run_at = anchor (cron will fire then).
    //   • If anchor is now-or-past, next_run_at = anchor too — and we'll
    //     trigger an immediate spawn below so the first occurrence lands now.
    //     The spawn edge function advances next_run_at past now() afterwards.
    const anchorMs = new Date(draft.anchor_at).getTime()
    const isImmediate = anchorMs <= Date.now() + 60 * 1000 // grace window

    // 1) Insert template row.
    const { data: tpl, error: insErr } = await supabase
      .from('task_recurrences')
      .insert({
        template_title:            draft.template_title.trim(),
        template_notes:            draft.template_notes || null,
        template_icon:             draft.template_icon || null,
        template_urgency:          draft.template_urgency || 'Med',
        template_due_offset_hours: draft.template_due_offset_hours ?? 24,
        team_id:                   draft.team_id || null,
        interval_unit:             draft.interval_unit,
        interval_every:            draft.interval_every,
        anchor_at:                 draft.anchor_at,
        next_run_at:               draft.anchor_at,
        created_by:                profile.id,
        is_active:                 draft.is_active !== false,
      })
      .select('id')
      .single()
    if (insErr) return { ok: false, msg: insErr.message }

    // 2) Insert assignee rows.
    const rows = (draft.assignee_ids || []).map((id, i) => ({
      recurrence_id: tpl.id,
      profile_id:    id,
      is_primary:    i === 0,
    }))
    if (rows.length > 0) {
      const { error: jErr } = await supabase
        .from('task_recurrence_assignees')
        .insert(rows)
      if (jErr) {
        // Roll back the template — orphan templates are useless.
        await supabase.from('task_recurrences').delete().eq('id', tpl.id)
        return { ok: false, msg: jErr.message }
      }
    }

    // 3) Immediate spawn for "Start = today / now / past" — fire the edge
    //    function so occurrence #1 lands within ~1 second instead of waiting
    //    up to an hour for the next cron tick. Fire-and-forget; the UI's
    //    realtime subscription will pick up the new task.
    if (isImmediate && draft.is_active !== false) {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      try {
        await fetch(`${supabaseUrl}/functions/v1/spawn-recurring-tasks`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': anonKey,
            'Authorization': `Bearer ${anonKey}`,
          },
          body: JSON.stringify({}),
        })
      } catch (e) {
        console.warn('Immediate spawn invoke failed (cron will catch up):', e)
      }
    }

    fetchAll()
    return { ok: true, id: tpl.id }
  }, [profile?.id, fetchAll])

  const updateTemplate = useCallback(async (id, patch) => {
    // If anchor_at, interval_unit, or interval_every changed, recompute next_run_at.
    let mergedPatch = { ...patch }
    if (patch.anchor_at || patch.interval_unit || patch.interval_every) {
      // Read current row to fill in any unchanged fields needed for the calc.
      const { data: cur } = await supabase
        .from('task_recurrences')
        .select('anchor_at, interval_unit, interval_every')
        .eq('id', id)
        .single()
      if (cur) {
        const { data: nextRun } = await supabase.rpc('compute_next_recurrence_run', {
          p_anchor_at:      patch.anchor_at      ?? cur.anchor_at,
          p_interval_unit:  patch.interval_unit  ?? cur.interval_unit,
          p_interval_every: patch.interval_every ?? cur.interval_every,
        })
        if (nextRun) mergedPatch.next_run_at = nextRun
      }
    }

    const { error } = await supabase
      .from('task_recurrences')
      .update(mergedPatch)
      .eq('id', id)
    if (!error) fetchAll()
    return { ok: !error, msg: error?.message }
  }, [fetchAll])

  // Patches the template AND optionally bulk-patches still-open spawned
  // tasks. Used by the Calendar-style "Apply to: future / future + existing"
  // confirm dialog. Fields that don't make sense to bulk-patch onto already-
  // spawned tasks (interval_*, anchor_at, is_active, team_id) are excluded
  // from the bulk update.
  const updateTemplateAndSpawnedTasks = useCallback(async (id, patch, opts = {}) => {
    const { applyToOpenSpawnedTasks = false } = opts
    const r = await updateTemplate(id, patch)
    if (!r.ok) return r
    if (!applyToOpenSpawnedTasks) return r

    const taskPatch = {}
    if (patch.template_title    !== undefined) taskPatch.title    = patch.template_title
    if (patch.template_notes    !== undefined) taskPatch.notes    = patch.template_notes
    if (patch.template_icon     !== undefined) taskPatch.icon     = patch.template_icon
    if (patch.template_urgency  !== undefined) taskPatch.urgency  = patch.template_urgency
    // team_id intentionally NOT propagated — moving an in-flight task across
    // teams would break RLS for current assignees. Future spawns get the new
    // team naturally.

    if (Object.keys(taskPatch).length === 0) return { ok: true }

    const { error } = await supabase
      .from('tasks')
      .update(taskPatch)
      .eq('recurrence_id', id)
      .neq('status', 'Done')
    if (error) return { ok: false, msg: error.message }
    return { ok: true }
  }, [updateTemplate])

  const setAssignees = useCallback(async (id, assigneeIds) => {
    // Replace the full assignee set: delete then insert. Cheaper than diffing
    // for v1 (typical assignee count is 1-3).
    const { error: delErr } = await supabase
      .from('task_recurrence_assignees')
      .delete()
      .eq('recurrence_id', id)
    if (delErr) return { ok: false, msg: delErr.message }

    if (assigneeIds.length === 0) {
      fetchAll()
      return { ok: true }
    }
    const rows = assigneeIds.map((pid, i) => ({
      recurrence_id: id,
      profile_id:    pid,
      is_primary:    i === 0,
    }))
    const { error: insErr } = await supabase
      .from('task_recurrence_assignees')
      .insert(rows)
    if (insErr) return { ok: false, msg: insErr.message }
    fetchAll()
    return { ok: true }
  }, [fetchAll])

  const setActive = useCallback(async (id, isActive) => {
    const { error } = await supabase
      .from('task_recurrences')
      .update({ is_active: isActive })
      .eq('id', id)
    if (!error) fetchAll()
    return { ok: !error, msg: error?.message }
  }, [fetchAll])

  const deleteTemplate = useCallback(async (id) => {
    const { error } = await supabase
      .from('task_recurrences')
      .delete()
      .eq('id', id)
    if (!error) fetchAll()
    return { ok: !error, msg: error?.message }
  }, [fetchAll])

  return {
    templates,
    loading,
    error,
    refetch:        fetchAll,
    createTemplate,
    updateTemplate,
    updateTemplateAndSpawnedTasks,
    setAssignees,
    setActive,
    deleteTemplate,
  }
}
