import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useTasks, useTaskActions, useProfiles } from './useTasks'
import { useAttachments } from './useAttachments'
import { severityToUrgency } from '../lib/projectBoard'
import { showToast } from '../components/ui/index'

const POS_STEP = 1000

// Bug lane for a project. Members report + triage; promote turns a bug into a
// real fix task (urgency from severity, 🐛 icon) and marks the bug Promoted.
// Mirrors useFeatureRequests.
export function useBugs(projectId) {
  const { profile } = useAuth()
  const { refetch: refetchTasks } = useTasks()
  const { assignTask } = useTaskActions()
  const { profiles } = useProfiles()
  const { copyProjectAttachmentsToTask } = useAttachments()
  const [bugs, setBugs] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchBugs = useCallback(async () => {
    if (!projectId) { setBugs([]); setLoading(false); return }
    const { data, error } = await supabase
      .from('bugs')
      .select('*, reporter:profiles(id, full_name, avatar_url)')
      .eq('project_id', projectId)
      .order('pos', { ascending: true })
    if (error) { console.warn('bugs fetch failed:', error.message); setLoading(false); return }
    setBugs(data || [])
    setLoading(false)
  }, [projectId])

  useEffect(() => { fetchBugs() }, [fetchBugs])

  const addBug = useCallback(async ({ title, description = null, severity = 'Medium' }) => {
    if (!projectId || !profile?.id || !title?.trim()) return null
    const pos = bugs.length ? Math.max(...bugs.map(b => b.pos ?? 0)) + POS_STEP : POS_STEP
    const { data, error } = await supabase.from('bugs')
      .insert({ project_id: projectId, title: title.trim(), description: description?.trim() || null, severity, reporter_id: profile.id, pos })
      .select().single()
    if (error) { showToast(error.message || 'Failed to report bug', 'error'); return null }
    await fetchBugs()
    return data
  }, [projectId, profile?.id, bugs, fetchBugs])

  const setStatus = useCallback(async (id, status) => {
    const { error } = await supabase.from('bugs').update({ status }).eq('id', id)
    if (error) { showToast(error.message || 'Failed to update bug', 'error'); return false }
    await fetchBugs()
    return true
  }, [fetchBugs])

  const updateBug = useCallback(async (id, patch) => {
    const { error } = await supabase.from('bugs').update(patch).eq('id', id)
    if (error) { showToast(error.message || 'Failed to update bug', 'error'); return false }
    await fetchBugs()
    return true
  }, [fetchBugs])

  const deleteBug = useCallback(async (id) => {
    const { error } = await supabase.from('bugs').delete().eq('id', id)
    if (error) { showToast(error.message || 'Failed to delete bug', 'error'); return false }
    await fetchBugs()
    return true
  }, [fetchBugs])

  // Promote: create a fix task from the bug, assigned to the promoter, into the
  // given column; urgency from severity + 🐛 icon. Then mark Promoted + link.
  const promote = useCallback(async (bug, { columnId = null, assigneeId = null } = {}) => {
    if (!bug || !profile?.id) return null
    const res = await assignTask({
      assigneeIds: [assigneeId || profile.id],
      title: bug.title,
      notes: bug.description || null,
      urgency: severityToUrgency(bug.severity),
      icon: '🐛',
      allProfiles: profiles,
      projectId: bug.project_id,
      projectColumnId: columnId,
      projectPos: POS_STEP,
    })
    if (!res?.ok) { showToast(res?.msg || 'Failed to promote bug', 'error'); return null }
    // Carry the bug's attached screenshots/files onto the new fix task.
    if (bug.attachments?.length) {
      const copy = await copyProjectAttachmentsToTask(res.task.id, bug.attachments)
      if (!copy.ok) showToast('Promoted, but some attachments did not carry over', 'error')
    }
    const { error } = await supabase.from('bugs')
      .update({ status: 'Promoted', promoted_task_id: res.task.id })
      .eq('id', bug.id)
    if (error) showToast(error.message || 'Promoted, but failed to link bug', 'error')
    await fetchBugs()
    await refetchTasks(true)
    showToast('Promoted to a fix task')
    return res.task
  }, [profile?.id, profiles, assignTask, copyProjectAttachmentsToTask, fetchBugs, refetchTasks])

  return { bugs, loading, addBug, setStatus, updateBug, deleteBug, promote, refetch: fetchBugs }
}
