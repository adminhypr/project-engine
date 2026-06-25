import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useTasks, useTaskActions, useProfiles } from './useTasks'
import { showToast } from '../components/ui/index'

const POS_STEP = 1000

// Feature Request backlog for a project. Members file + triage; promote turns a
// request into a real Feature (task) and marks the request Promoted.
export function useFeatureRequests(projectId) {
  const { profile } = useAuth()
  const { refetch: refetchTasks } = useTasks()
  const { assignTask } = useTaskActions()
  const { profiles } = useProfiles()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchRequests = useCallback(async () => {
    if (!projectId) { setRequests([]); setLoading(false); return }
    const { data, error } = await supabase
      .from('feature_requests')
      .select('*, requester:profiles(id, full_name, avatar_url)')
      .eq('project_id', projectId)
      .order('pos', { ascending: true })
    if (error) { console.warn('feature_requests fetch failed:', error.message); setLoading(false); return }
    setRequests(data || [])
    setLoading(false)
  }, [projectId])

  useEffect(() => { fetchRequests() }, [fetchRequests])

  const addRequest = useCallback(async ({ title, description = null }) => {
    if (!projectId || !profile?.id || !title?.trim()) return null
    const pos = requests.length ? Math.max(...requests.map(r => r.pos ?? 0)) + POS_STEP : POS_STEP
    const { data, error } = await supabase.from('feature_requests')
      .insert({ project_id: projectId, title: title.trim(), description: description?.trim() || null, requester_id: profile.id, pos })
      .select().single()
    if (error) { showToast(error.message || 'Failed to add request', 'error'); return null }
    await fetchRequests()
    return data
  }, [projectId, profile?.id, requests, fetchRequests])

  const setStatus = useCallback(async (id, status) => {
    const { error } = await supabase.from('feature_requests').update({ status }).eq('id', id)
    if (error) { showToast(error.message || 'Failed to update request', 'error'); return false }
    await fetchRequests()
    return true
  }, [fetchRequests])

  const updateRequest = useCallback(async (id, patch) => {
    const { error } = await supabase.from('feature_requests').update(patch).eq('id', id)
    if (error) { showToast(error.message || 'Failed to update request', 'error'); return false }
    await fetchRequests()
    return true
  }, [fetchRequests])

  const deleteRequest = useCallback(async (id) => {
    const { error } = await supabase.from('feature_requests').delete().eq('id', id)
    if (error) { showToast(error.message || 'Failed to delete request', 'error'); return false }
    await fetchRequests()
    return true
  }, [fetchRequests])

  // Promote: create a Feature (task) from the request, assigned to the promoter,
  // into the given column; then mark the request Promoted + link it. Two awaited
  // steps — reuses assignTask rather than re-implementing task_id/triggers in SQL.
  const promote = useCallback(async (request, { columnId = null, assigneeId = null } = {}) => {
    if (!request || !profile?.id) return null
    const res = await assignTask({
      assigneeIds: [assigneeId || profile.id],
      title: request.title,
      notes: request.description || null,
      allProfiles: profiles,
      projectId: request.project_id,
      projectColumnId: columnId,
      projectPos: POS_STEP,
    })
    if (!res?.ok) { showToast(res?.msg || 'Failed to promote request', 'error'); return null }
    const { error } = await supabase.from('feature_requests')
      .update({ status: 'Promoted', promoted_task_id: res.task.id })
      .eq('id', request.id)
    if (error) showToast(error.message || 'Promoted, but failed to link request', 'error')
    await fetchRequests()
    await refetchTasks(true)
    showToast('Promoted to a feature')
    return res.task
  }, [profile?.id, profiles, assignTask, fetchRequests, refetchTasks])

  return { requests, loading, addRequest, setStatus, updateRequest, deleteRequest, promote, refetch: fetchRequests }
}
