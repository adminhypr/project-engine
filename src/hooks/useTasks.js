import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { getPriority } from '../lib/priority'
import { getAssignmentType } from '../lib/assignmentType'
import { generateTaskId } from '../lib/helpers'
import { useAuth } from './useAuth'

const TASK_SELECT = `
  *,
  assignee:profiles!tasks_assigned_to_fkey(id, full_name, email, role, team_id, reports_to, teams(name)),
  assigner:profiles!tasks_assigned_by_fkey(id, full_name, email, role, team_id, teams(name)),
  team:teams(id, name),
  comments(count)
`

export function useTasks() {
  const { profile, isAdmin, isManager } = useAuth()
  const [tasks,   setTasks]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const fetchTasks = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setError(null)

    let query = supabase.from('tasks').select(TASK_SELECT).order('date_assigned', { ascending: false })

    if (!isAdmin && isManager) {
      query = query.eq('team_id', profile.team_id)
    }

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

    const enriched = (data || []).map(t => ({
      ...t,
      priority:     getPriority(t),
      comment_count: t.comments?.[0]?.count || 0,
      assignee: t.assignee ? { ...t.assignee, manager: managerMap[t.assignee.reports_to] || null } : t.assignee,
    }))

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
        () => fetchTasks())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile, fetchTasks])

  // My tasks only
  const myTasks = tasks.filter(t => t.assigned_to === profile?.id)

  // Team tasks (for manager view)
  const teamTasks = isManager
    ? tasks.filter(t => t.team_id === profile?.team_id)
    : []

  return { tasks, myTasks, teamTasks, loading, error, refetch: fetchTasks }
}

export function useTaskActions() {
  const { profile } = useAuth()

  async function assignTask(payload) {
    const { assigneeId, title, urgency, dueDate, whoTo, notes, icon, allProfiles, overrideAssignerId } = payload

    const assignee = allProfiles.find(p => p.id === assigneeId)
    const statedAssigner = overrideAssignerId
      ? allProfiles.find(p => p.id === overrideAssignerId)
      : profile
    const actualAssigner = profile

    const assignmentType = getAssignmentType(statedAssigner, assignee)
    const taskId = generateTaskId()

    const { data, error } = await supabase.from('tasks').insert({
      task_id:         taskId,
      assigned_to:     assigneeId,
      assigned_by:     statedAssigner?.id || profile.id,
      assignment_type: assignmentType,
      team_id:         assignee?.team_id,
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

  return { assignTask, updateTask, addComment, getTaskComments, acceptTask, declineTask, reassignTask }
}

export function useProfiles() {
  const [profiles, setProfiles] = useState([])
  const [teams,    setTeams]    = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    async function load() {
      const [{ data: pData }, { data: tData }] = await Promise.all([
        supabase.from('profiles').select('*, teams(id, name)').order('full_name'),
        supabase.from('teams').select('*').order('name')
      ])
      // Resolve manager names client-side from the same profiles list
      const profileList = pData || []
      const profileMap = Object.fromEntries(profileList.map(p => [p.id, p]))
      const enriched = profileList.map(p => ({
        ...p,
        manager: p.reports_to ? { id: p.reports_to, full_name: profileMap[p.reports_to]?.full_name } : null
      }))
      setProfiles(enriched)
      setTeams(tData || [])
      setLoading(false)
    }
    load()
  }, [])

  return { profiles, teams, loading }
}
