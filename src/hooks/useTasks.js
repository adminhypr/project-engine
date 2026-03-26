import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getPriority } from '../lib/priority'
import { getAssignmentType } from '../lib/assignmentType'
import { generateTaskId } from '../lib/helpers'
import { useAuth } from './useAuth'

const TASK_SELECT = `
  *,
  assignee:profiles!tasks_assigned_to_fkey(id, full_name, email, role, team_id, reports_to, teams!profiles_team_id_fkey(name), profile_teams!profile_teams_profile_id_fkey(team_id, is_primary, role, team:teams!profile_teams_team_id_fkey(id, name))),
  assigner:profiles!tasks_assigned_by_fkey(id, full_name, email, role, team_id, teams!profiles_team_id_fkey(name), profile_teams!profile_teams_profile_id_fkey(team_id, is_primary, role, team:teams!profile_teams_team_id_fkey(id, name))),
  task_assignees(profile_id, is_primary, profile:profiles(id, full_name, avatar_url)),
  team:teams(id, name),
  comments(count)
`

export function useTasks() {
  const { profile, isAdmin, isManager } = useAuth()
  const [tasks,   setTasks]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const fetchTasks = useCallback(async (silent = false) => {
    if (!profile) return
    if (!silent) setLoading(true)
    setError(null)

    let query = supabase.from('tasks').select(TASK_SELECT).order('date_assigned', { ascending: false })

    // RLS handles team filtering for managers (supports multi-team).
    // No client-side filter needed — managers see tasks for all their teams.

    const { data, error } = await query
    if (error) { setError(error.message); setLoading(false); return }

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

    const enriched = (data || []).map(t => {
      // Enrich assignee/assigner with team_ids from profile_teams
      const enrichProfile = (p) => {
        if (!p) return p
        const pt = p.profile_teams || []
        return {
          ...p,
          team_ids: pt.length > 0 ? pt.map(r => r.team_id) : (p.team_id ? [p.team_id] : []),
          all_teams: pt.length > 0 ? pt.map(r => ({ ...r.team, is_primary: r.is_primary, role: r.role })) : (p.teams ? [{ id: p.team_id, name: p.teams.name, is_primary: true }] : []),
          team_roles: pt.length > 0 ? Object.fromEntries(pt.map(r => [r.team_id, r.role])) : {}
        }
      }
      // Build assignees array from junction table
      const assignees = (t.task_assignees || []).map(ta => ({
        id: ta.profile?.id || ta.profile_id,
        full_name: ta.profile?.full_name,
        avatar_url: ta.profile?.avatar_url,
        is_primary: ta.is_primary,
      }))

      return {
        ...t,
        priority:      getPriority(t),
        comment_count: t.comments?.[0]?.count || 0,
        assignee:      t.assignee ? { ...enrichProfile(t.assignee), manager: managerMap[t.assignee.reports_to] || null } : t.assignee,
        assigner:      enrichProfile(t.assigner),
        assignees,
      }
    })

    setTasks(enriched)
    setLoading(false)
  }, [profile, isAdmin, isManager])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  // Real-time subscription
  useEffect(() => {
    if (!profile) return
    const channel = supabase
      .channel('tasks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' },
        () => fetchTasks(true))
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile, fetchTasks])

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
    const { assigneeIds, assigneeId, title, urgency, dueDate, whoTo, notes, icon, allProfiles, overrideAssignerId, teamId } = payload

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
      status:          'Not Started'
    }).select().single()

    if (error) return { ok: false, msg: error.message }

    // Insert all assignees into junction table
    if (data) {
      const rows = ids.map((id, i) => ({
        task_id: data.id,
        profile_id: id,
        is_primary: i === 0,
      }))
      await supabase.from('task_assignees').insert(rows)
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

  async function addComment(taskId, content) {
    const { data, error } = await supabase.from('comments').insert({
      task_id:   taskId,
      author_id: profile.id,
      content
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
    const { error } = await supabase
      .from('tasks')
      .update({
        assigned_to: newAssigneeId,
        acceptance_status: 'Pending',
        decline_reason: null,
        accepted_at: null,
        declined_at: null
      })
      .eq('id', taskId)
    if (error) return { ok: false, msg: error.message }
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

export function useProfiles() {
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
      setProfiles(enriched)
      setTeams(tData || [])
      setLoading(false)
    }
    load()
  }, [])

  return { profiles, teams, loading }
}
