import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { getPriority } from '../lib/priority'
import { getAssignmentType } from '../lib/assignmentType'
import { generateTaskId } from '../lib/helpers'
import { useAuth } from './useAuth'
import { playTaskSound } from '../lib/notificationSounds'
import { onMessage } from '../lib/dmEventBus'
import { buildSubtaskCounts } from '../lib/subtasks'

// Sender-side realtime "poke": nudge an assignee's task list to refetch
// immediately, bypassing any RLS/filter edge cases on postgres_changes for
// the tasks + task_assignees tables. Each assignee's useTasks hook
// subscribes to user:{theirId}:task-poke; this function sends one
// broadcast on that channel and tears the channel down.
async function pokeAssignee(userId) {
  const topic = `user:${userId}:task-poke`
  const ch = supabase.channel(topic, { config: { broadcast: { self: false } } })
  await new Promise((resolve) => {
    ch.subscribe((status) => { if (status === 'SUBSCRIBED') resolve() })
    // Safety timeout so we don't hang if the socket is down.
    setTimeout(resolve, 1500)
  })
  try {
    await ch.send({ type: 'broadcast', event: 'task-changed', payload: {} })
  } finally {
    // Leave a short beat for the broker to flush before removing.
    setTimeout(() => { try { supabase.removeChannel(ch) } catch { /* noop */ } }, 250)
  }
}

// Lean read-time SELECT. Heavy nested embeds (profile_teams, nested team data,
// per-row comment count, attachment count) were dropped after audit:
//   • attachment_count had zero consumers in the app.
//   • comment_count is now fetched via get_user_task_comment_counts() RPC
//     (one aggregation, not N LATERAL subqueries).
//   • assignee.team_ids / team_roles / all_teams aren't read off task.assignee
//     anywhere in the app — those fields are only used off useAuth().profile
//     or useProfiles(). Pulling them per task was pure waste.
// reports_to stays on assignee because the manager chip uses it for lookup.
const TASK_SELECT_FULL = `
  *,
  assignee:profiles!tasks_assigned_to_fkey(id, full_name, avatar_url, reports_to),
  assigner:profiles!tasks_assigned_by_fkey(id, full_name),
  task_assignees!task_assignees_task_id_fkey(profile_id, is_primary, completed_at, completed_by, profile:profiles!task_assignees_profile_id_fkey(id, full_name, avatar_url)),
  team:teams(id, name)
`

const TASK_SELECT_FALLBACK = `
  *,
  assignee:profiles!tasks_assigned_to_fkey(id, full_name, avatar_url, reports_to),
  assigner:profiles!tasks_assigned_by_fkey(id, full_name),
  team:teams(id, name)
`

export function useTasks() {
  const { profile, isAdmin, isManager } = useAuth()
  const [tasks,   setTasks]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  // Refs keep fetchTasks stable so the realtime subscription doesn't tear down/re-subscribe
  const profileRef = useRef(profile)
  const isAdminRef = useRef(isAdmin)
  const isManagerRef = useRef(isManager)
  useEffect(() => {
    profileRef.current = profile
    isAdminRef.current = isAdmin
    isManagerRef.current = isManager
  }, [profile, isAdmin, isManager])

  // Mirror the current tasks array so realtime handlers can answer
  // "is this row in my list?" without re-subscribing on every change.
  const tasksRef = useRef([])
  useEffect(() => { tasksRef.current = tasks }, [tasks])

  const fetchTasks = useCallback(async (silent = false) => {
    if (!profileRef.current) return
    if (!silent) setLoading(true)
    setError(null)

    // Run the main task query and the comment-count aggregation in parallel.
    // Comment counts used to be a per-row LATERAL subquery via PostgREST's
    // `comments(count)` embed — fine for a few rows, brutal for 100+.
    let usedFallback = false
    const [tasksRes, commentCountsRes] = await Promise.all([
      supabase.from('tasks').select(TASK_SELECT_FULL).order('date_assigned', { ascending: false }),
      supabase.rpc('get_user_task_comment_counts'),
    ])
    let { data, error } = tasksRes
    if (error) {
      console.warn('task_assignees join failed, using fallback query:', error.message)
      usedFallback = true
      const retry = await supabase.from('tasks').select(TASK_SELECT_FALLBACK).order('date_assigned', { ascending: false })
      data = retry.data
      error = retry.error
    }
    if (error) { setError(error.message); setLoading(false); return }

    const commentCountByTaskId = new Map()
    if (commentCountsRes?.error) {
      console.warn('get_user_task_comment_counts failed:', commentCountsRes.error.message)
    } else if (commentCountsRes?.data) {
      for (const r of commentCountsRes.data) {
        commentCountByTaskId.set(r.task_id, Number(r.comment_count) || 0)
      }
    }

    // If fallback was used, fetch task_assignees separately
    let assigneesMap = {}
    if (usedFallback && data?.length) {
      const { data: taData } = await supabase
        .from('task_assignees')
        .select('task_id, profile_id, is_primary, completed_at, completed_by, profile:profiles(id, full_name, avatar_url)')
      if (taData) {
        for (const ta of taData) {
          if (!assigneesMap[ta.task_id]) assigneesMap[ta.task_id] = []
          assigneesMap[ta.task_id].push(ta)
        }
      }
    }

    // Resolve reporting manager names for assignees
    const managerIds = [...new Set((data || []).map(t => t.assignee?.reports_to).filter(Boolean))]
    let managerMap = {}
    if (managerIds.length > 0) {
      const { data: managers } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', managerIds)
      if (managers) {
        managerMap = Object.fromEntries(managers.map(m => [m.id, m]))
      }
    }

    // Unread task-chat counts for the current user. One RPC call instead
    // of N+1 HEAD count queries (migration 052).
    const taskIds = (data || []).map(t => t.id).filter(Boolean)
    const unreadByTaskId = new Map()
    if (taskIds.length > 0) {
      const { data: unreadRows, error: unreadErr } = await supabase
        .rpc('get_user_task_chat_unreads', { p_task_ids: taskIds })
      if (unreadErr) {
        console.warn('get_user_task_chat_unreads failed:', unreadErr.message)
      } else if (unreadRows) {
        for (const r of unreadRows) {
          unreadByTaskId.set(r.task_id, Number(r.unread_count) || 0)
        }
      }
    }

    const subtaskCounts = buildSubtaskCounts(data || [])

    const enriched = (data || []).map(t => {
      // Build assignees array from junction table (inline join or fallback map)
      const rawAssignees = t.task_assignees?.length ? t.task_assignees : (assigneesMap[t.id] || [])
      const assignees = rawAssignees.map(ta => ({
        id: ta.profile?.id || ta.profile_id,
        full_name: ta.profile?.full_name,
        avatar_url: ta.profile?.avatar_url,
        is_primary: ta.is_primary,
        completed_at: ta.completed_at ?? null,
        completed_by: ta.completed_by ?? null,
      }))

      const counts = subtaskCounts.get(t.id) || { total: 0, open: 0 }
      return {
        ...t,
        priority:      getPriority(t),
        comment_count: commentCountByTaskId.get(t.id) || 0,
        unread_chat_count: unreadByTaskId.get(t.id) || 0,
        subtask_count:      counts.total,
        open_subtask_count: counts.open,
        assignee:      t.assignee ? { ...t.assignee, manager: managerMap[t.assignee.reports_to] || null } : t.assignee,
        assignees,
      }
    })

    if (typeof window !== 'undefined' && window.__pe_debug) {
      console.log('[pe-debug] setTasks', enriched.length, 'rows silent=', silent)
    }
    setTasks(enriched)
    setLoading(false)
  }, []) // profile/isAdmin/isManager accessed via refs to keep identity stable

  // Initial fetch — re-run only when profile arrives (not on every reference change)
  const profileId = profile?.id
  useEffect(() => { fetchTasks() }, [profileId, fetchTasks])

  // Real-time subscriptions.
  //
  // Two channels are needed:
  //   1. tasks — primary assignees (assigned_to = me) or tasks I created see
  //      INSERT/UPDATE/DELETE directly. Their RLS SELECT check passes on
  //      those columns at the moment the row is written.
  //   2. task_assignees — **secondary** assignees (everyone past the first in
  //      a multi-owner assignment) can't see the tasks INSERT yet: the
  //      junction row that grants them RLS access is written in a second
  //      insert right after. So we listen to the junction and refetch when
  //      a row mentions me.
  //
  // Without (2), the recipient of a multi-owner assignment had to refresh
  // the page before the new task appeared — which is what users were
  // reporting.
  //
  // Refetches are coalesced through scheduleRefetch() so a burst of events
  // from one logical action (e.g. assigning a task with 4 assignees writes
  // 1 tasks row + 4 task_assignees rows in milliseconds) collapses to a
  // single fetch. Events that don't affect the current user's visible task
  // list are dropped entirely — that's the fix for the "page auto-refreshes
  // whenever something changes elsewhere" UX bug.
  useEffect(() => {
    if (!profileId) return

    let refetchTimer = null
    function scheduleRefetch() {
      if (refetchTimer) return
      refetchTimer = setTimeout(() => {
        refetchTimer = null
        fetchTasks(true)
      }, 250)
    }

    // Reconnect-aware status tracking: the first SUBSCRIBED is the initial
    // connect (no refetch — we've just fetched). Each subsequent transition
    // from a non-SUBSCRIBED state back to SUBSCRIBED means we reconnected,
    // and we refetch to catch anything missed during the outage.
    let everConnected = false
    function onStatus(status) {
      if (status === 'SUBSCRIBED') {
        if (everConnected) scheduleRefetch()
        everConnected = true
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        everConnected = false
      }
    }

    // Tasks channel — primary assignees / task creators / managers see events
    // directly through RLS. Even with RLS, an admin/manager sees changes for
    // tasks they don't actively care about (e.g. another team member's notes
    // tweak). Filter to "involves me OR already in my list" so unrelated
    // backend churn doesn't redraw the page.
    const tasksChannel = supabase
      .channel('tasks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' },
        (payload) => {
          const newRow = payload.new
          const oldRow = payload.old
          const row = newRow || oldRow
          if (!row) return

          const involvesMe =
            newRow?.assigned_to === profileId || newRow?.assigned_by === profileId ||
            oldRow?.assigned_to === profileId || oldRow?.assigned_by === profileId
          const inMyList = tasksRef.current.some(t => t.id === row.id)
          if (!involvesMe && !inMyList) return

          if (payload.eventType === 'INSERT' && newRow?.assigned_to === profileId && newRow?.assigned_by !== profileId) {
            playTaskSound()
          }
          scheduleRefetch()
        })
      .subscribe(onStatus)

    // Task-assignees channel — secondary assignees land here (tasks INSERT is
    // suppressed by RLS until their junction row exists).
    //
    // Deliberately UNFILTERED on profile_id at the subscription level —
    // server-side realtime filters on composite-PK tables are known to drop
    // events under some conditions. We filter client-side instead, where the
    // logic is "row references me OR row references a task I can already
    // see". The earlier version refetched on every event and was the loudest
    // source of the spurious-refresh bug.
    const assigneesChannel = supabase
      .channel('task-assignees-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_assignees' },
        (payload) => {
          const newRow = payload.new
          const oldRow = payload.old
          const row = newRow || oldRow
          if (!row) return

          const involvesMe = newRow?.profile_id === profileId || oldRow?.profile_id === profileId
          const inMyList = tasksRef.current.some(t => t.id === row.task_id)
          if (!involvesMe && !inMyList) return

          // Sound only on NEW assignments to the current user.
          if (payload.eventType === 'INSERT' && !row.is_primary && row.profile_id === profileId) {
            playTaskSound()
          }
          scheduleRefetch()
        }
      )
      .subscribe()

    // User-scoped broadcast channel — the sender-side "poke" from
    // assignTask fires here. This is RLS-free and filter-free, so it's the
    // single most reliable signal we have. If WebSocket is up at all, this
    // path works.
    const pokeChannel = supabase
      .channel(`user:${profileId}:task-poke`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'task-changed' }, () => {
        playTaskSound()
        scheduleRefetch()
      })
      .subscribe()

    return () => {
      if (refetchTimer) { clearTimeout(refetchTimer); refetchTimer = null }
      supabase.removeChannel(tasksChannel)
      supabase.removeChannel(assigneesChannel)
      supabase.removeChannel(pokeChannel)
    }
  }, [profileId, fetchTasks])

  // (Tab-visible refetch removed.) Browsers don't always tear down the
  // websocket on background tabs, so a "silent" refetch on every visibility
  // flip mostly does nothing — but it ALWAYS swaps the `tasks` array and
  // every task object identity, which propagates as a new prop into
  // TaskDetailPanel and causes a perceptible re-render burst on tab return.
  // Missed events are already covered by the reconnect-aware refetch above
  // (fires only when the realtime channel actually went down and came back),
  // and by the user-scoped task-poke broadcast for new assignments.

  // Refresh unread_chat_count when DM messages arrive. The global
  // useDmRealtime subscription fires dmEventBus "message" events for any
  // conversation the user participates in — including task chats. We only
  // need the unread counts here, so run the unread-counts RPC alone and
  // patch tasks in place; full fetchTasks would re-render every row for a
  // single-column update. Debounced to coalesce paste-multiple bursts.
  useEffect(() => {
    if (!profileId) return
    let timer = null
    const unsub = onMessage(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        const ids = tasksRef.current.map(t => t.id).filter(Boolean)
        if (ids.length === 0) return
        const { data: rows, error: err } = await supabase
          .rpc('get_user_task_chat_unreads', { p_task_ids: ids })
        if (err) {
          console.warn('get_user_task_chat_unreads (dm refresh) failed:', err.message)
          return
        }
        const unreadByTaskId = new Map()
        for (const r of rows || []) {
          unreadByTaskId.set(r.task_id, Number(r.unread_count) || 0)
        }
        // Patch only the unread_chat_count column. Bail out with the
        // existing array reference if no row's count actually changed, so
        // unrelated subscribers don't see a state-update notification.
        setTasks(prev => {
          let changed = false
          const next = prev.map(t => {
            const newCount = unreadByTaskId.get(t.id) || 0
            if ((t.unread_chat_count || 0) === newCount) return t
            changed = true
            return { ...t, unread_chat_count: newCount }
          })
          return changed ? next : prev
        })
      }, 500)
    })
    return () => { if (timer) clearTimeout(timer); unsub() }
  }, [profileId])

  // My tasks only (primary + secondary assignee)
  const myTasks = tasks.filter(t =>
    t.assigned_to === profile?.id ||
    t.task_assignees?.some(ta => ta.profile_id === profile?.id)
  )

  // Team tasks (for manager view) — only teams where user has Manager role
  const teamTasks = isManager
    ? tasks.filter(t => {
        if (profile?.role === 'Admin') return true
        const teamRoles = profile?.team_roles || {}
        return teamRoles[t.team_id] === 'Manager'
      })
    : []

  return { tasks, myTasks, teamTasks, loading, error, refetch: fetchTasks }
}

export function useTaskActions() {
  const { profile } = useAuth()

  async function assignTask(payload) {
    const { assigneeIds, assigneeId, title, urgency, dueDate, whoTo, notes, icon, allProfiles, overrideAssignerId, teamId, parentTaskId } = payload

    // Support both single assigneeId (legacy) and multiple assigneeIds
    const ids = assigneeIds?.length ? assigneeIds : [assigneeId]
    const primaryId = ids[0]
    const assignee = allProfiles.find(p => p.id === primaryId)
    const statedAssigner = overrideAssignerId
      ? allProfiles.find(p => p.id === overrideAssignerId)
      : profile
    const actualAssigner = profile

    const resolvedTeam = teamId || assignee?.team_id
    const assignmentType = getAssignmentType(statedAssigner, assignee, resolvedTeam)
    const taskId = generateTaskId()

    const { data, error } = await supabase.from('tasks').insert({
      task_id:         taskId,
      assigned_to:     primaryId,
      assigned_by:     statedAssigner?.id || profile.id,
      assignment_type: assignmentType,
      team_id:         resolvedTeam,
      title,
      urgency:         urgency || 'Med',
      due_date:        dueDate || null,
      who_due_to:      whoTo || null,
      notes:           notes || null,
      icon:            icon || null,
      date_assigned:   new Date().toISOString(),
      status:          'Not Started',
      parent_task_id:  parentTaskId || null,
    }).select().single()

    if (error) return { ok: false, msg: error.message }

    // Insert all assignees into junction table — must await so data exists before real-time refetch
    if (data) {
      const rows = ids.map((id, i) => ({
        task_id: data.id,
        profile_id: id,
        is_primary: i === 0,
      }))
      const { error: jErr } = await supabase.from('task_assignees').insert(rows)
      if (jErr) console.warn('task_assignees insert failed:', jErr.message)

      // Sender-side "poke": broadcast a task-changed event to each assignee's
      // private channel. This is the most reliable path for the recipient —
      // it bypasses the tasks+task_assignees RLS/replica-identity maze that
      // can cause postgres_changes events to be dropped for secondary
      // assignees. Fire-and-forget; each assignee's useTasks hook is
      // subscribed to user:{id}:task-poke.
      for (const id of ids) {
        if (id === profile?.id) continue // no need to poke self
        pokeAssignee(id).catch(() => { /* noop */ })
      }
    }

    // Log assigner override to audit log
    if (overrideAssignerId && overrideAssignerId !== profile.id && data) {
      await supabase.from('task_audit_log').insert({
        task_id:      data.id,
        event_type:   'assigner_override',
        performed_by: actualAssigner.id,
        old_value:    actualAssigner.full_name,
        new_value:    statedAssigner?.full_name,
        note:         `Entered by ${actualAssigner.full_name} on behalf of ${statedAssigner?.full_name}`
      })
    }

    return { ok: true, task: data, taskId, assignmentType }
  }

  async function updateTask(taskId, updates) {
    const { error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', taskId)
    if (error) return { ok: false, msg: error.message }
    return { ok: true }
  }

  async function addComment(taskId, content, mentionedIds = []) {
    const { data, error } = await supabase.from('comments').insert({
      task_id:   taskId,
      author_id: profile.id,
      content,
      mentioned_ids: Array.isArray(mentionedIds) ? mentionedIds : [],
    }).select('*, author:profiles(full_name, avatar_url)').single()

    if (error) return { ok: false, msg: error.message }
    return { ok: true, comment: data }
  }

  async function getTaskComments(taskId) {
    const { data, error } = await supabase
      .from('comments')
      .select('*, author:profiles(full_name, avatar_url)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
    if (error) return []
    return data || []
  }

  async function acceptTask(taskId) {
    const { error } = await supabase
      .from('tasks')
      .update({ acceptance_status: 'Accepted', accepted_at: new Date().toISOString() })
      .eq('id', taskId)
    if (error) return { ok: false, msg: error.message }
    return { ok: true }
  }

  async function declineTask(taskId, reason) {
    const { error } = await supabase
      .from('tasks')
      .update({
        acceptance_status: 'Declined',
        decline_reason: reason || null,
        declined_at: new Date().toISOString()
      })
      .eq('id', taskId)
    if (error) return { ok: false, msg: error.message }
    return { ok: true }
  }

  async function reassignTask(taskId, newAssigneeId) {
    // Resolve the OLD primary assignee before we overwrite it. Everything
    // below hinges on this — if we can't read the current row (RLS, missing
    // id, etc.) we bail out rather than silently skipping cleanup.
    const { data: current, error: fetchErr } = await supabase
      .from('tasks')
      .select('id, assigned_to')
      .eq('id', taskId)
      .maybeSingle()
    if (fetchErr) return { ok: false, msg: fetchErr.message }
    if (!current) return { ok: false, msg: 'Task not found' }

    const oldAssigneeId = current.assigned_to

    // No-op reassignment — nothing to do. Don't churn chat/assignee rows.
    if (oldAssigneeId === newAssigneeId) return { ok: true }

    // 1) Remove the OLD primary's junction row. Do this before the task
    //    UPDATE so any downstream trigger on tasks sees a clean slate.
    if (oldAssigneeId) {
      const { error: delErr } = await supabase
        .from('task_assignees')
        .delete()
        .eq('task_id', taskId)
        .eq('profile_id', oldAssigneeId)
        .eq('is_primary', true)
      if (delErr) return { ok: false, msg: delErr.message }
    }

    // 2) Flip the task to the new primary + reset acceptance state. Also
    //    clear email_alert_sent so the new assignee can receive red alerts.
    const { error: updErr } = await supabase
      .from('tasks')
      .update({
        assigned_to: newAssigneeId,
        acceptance_status: 'Pending',
        decline_reason: null,
        accepted_at: null,
        declined_at: null,
        email_alert_sent: false,
      })
      .eq('id', taskId)
    if (updErr) return { ok: false, msg: updErr.message }

    // 3) Insert the NEW primary's junction row. Upsert in case the new
    //    assignee was already a secondary — we promote them to primary.
    const { error: insErr } = await supabase
      .from('task_assignees')
      .upsert(
        { task_id: taskId, profile_id: newAssigneeId, is_primary: true },
        { onConflict: 'task_id,profile_id' }
      )
    if (insErr) return { ok: false, msg: insErr.message }

    // 4) Best-effort: remove the OLD assignee from the task's chat. The
    //    sync_task_chat_participant trigger (migration 046) enrols the new
    //    one automatically; it does NOT remove stale participants.
    if (oldAssigneeId) {
      try {
        const { data: conv } = await supabase
          .from('conversations')
          .select('id')
          .eq('kind', 'task')
          .eq('task_id', taskId)
          .maybeSingle()
        if (conv) {
          await supabase
            .from('conversation_participants')
            .delete()
            .eq('conversation_id', conv.id)
            .eq('user_id', oldAssigneeId)
        }
      } catch (e) {
        // Chat cleanup failing shouldn't fail the reassignment.
        console.warn('reassignTask: chat participant cleanup failed:', e)
      }
    }

    return { ok: true }
  }

  async function deleteTask(taskId) {
    const { error } = await supabase
      .from('tasks')
      .delete()
      .eq('id', taskId)
    if (error) return { ok: false, msg: error.message }
    return { ok: true }
  }

  async function deleteTasks(taskIds) {
    const { error } = await supabase
      .from('tasks')
      .delete()
      .in('id', taskIds)
    if (error) return { ok: false, msg: error.message }
    return { ok: true }
  }

  async function updateTasks(taskIds, updates) {
    const { error } = await supabase
      .from('tasks')
      .update(updates)
      .in('id', taskIds)
    if (error) return { ok: false, msg: error.message }
    return { ok: true }
  }

  async function addAssignee(taskId, profileId) {
    const { error } = await supabase.from('task_assignees').insert({
      task_id: taskId,
      profile_id: profileId,
      is_primary: false,
    })
    if (error) return { ok: false, msg: error.message }
    return { ok: true }
  }

  async function removeAssignee(taskId, profileId) {
    const { error } = await supabase.from('task_assignees')
      .delete()
      .eq('task_id', taskId)
      .eq('profile_id', profileId)
    if (error) return { ok: false, msg: error.message }
    return { ok: true }
  }

  return { assignTask, updateTask, addComment, getTaskComments, acceptTask, declineTask, reassignTask, deleteTask, deleteTasks, updateTasks, addAssignee, removeAssignee }
}

export function useProfiles({ excludeExternals = false } = {}) {
  const [profiles, setProfiles] = useState([])
  const [teams,    setTeams]    = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: pData }, { data: tData }] = await Promise.all([
        supabase.from('profiles').select('*, teams!profiles_team_id_fkey(id, name), profile_teams!profile_teams_profile_id_fkey(team_id, is_primary, role, team:teams!profile_teams_team_id_fkey(id, name))').order('full_name'),
        supabase.from('teams').select('*').order('name')
      ])
      // Resolve manager names + enrich with multi-team data
      const profileList = pData || []
      const profileMap = Object.fromEntries(profileList.map(p => [p.id, p]))
      const enriched = profileList.map(p => {
        const pt = p.profile_teams || []
        return {
          ...p,
          team_ids: pt.length > 0 ? pt.map(r => r.team_id) : (p.team_id ? [p.team_id] : []),
          all_teams: pt.length > 0 ? pt.map(r => ({ ...r.team, is_primary: r.is_primary, role: r.role })) : (p.teams ? [{ ...p.teams, is_primary: true }] : []),
          team_roles: pt.length > 0 ? Object.fromEntries(pt.map(r => [r.team_id, r.role])) : {},
          manager: p.reports_to ? { id: p.reports_to, full_name: profileMap[p.reports_to]?.full_name } : null
        }
      })
      const filtered = excludeExternals
        ? enriched.filter(p => p.role !== 'Agent' && p.role !== 'Client')
        : enriched
      setProfiles(filtered)
      setTeams(tData || [])
      setLoading(false)
    }
    load()
  }, [excludeExternals])

  return { profiles, teams, loading }
}
