import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useTasks, useTaskActions, useProfiles } from './useTasks'
import { showToast } from '../components/ui/index'

const POS_STEP = 1000

// Project board columns (the Trello "lists"). Owner/admin-gated writes by RLS.
export function useProjectColumns(projectId) {
  const [columns, setColumns] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchColumns = useCallback(async () => {
    if (!projectId) { setColumns([]); setLoading(false); return }
    const { data, error } = await supabase
      .from('project_columns')
      .select('*')
      .eq('project_id', projectId)
      .order('pos', { ascending: true })
    if (error) { console.warn('project_columns fetch failed:', error.message); setLoading(false); return }
    setColumns(data || [])
    setLoading(false)
  }, [projectId])

  useEffect(() => { fetchColumns() }, [fetchColumns])

  const addColumn = useCallback(async ({ name, color = null, mapsToStatus = null }) => {
    if (!projectId || !name?.trim()) return null
    const pos = columns.length ? Math.max(...columns.map(c => c.pos ?? 0)) + POS_STEP : POS_STEP
    const { data, error } = await supabase.from('project_columns')
      .insert({ project_id: projectId, name: name.trim(), color, maps_to_status: mapsToStatus, pos })
      .select().single()
    if (error) { showToast(error.message || 'Failed to add list', 'error'); return null }
    await fetchColumns()
    return data
  }, [projectId, columns, fetchColumns])

  const updateColumn = useCallback(async (id, patch) => {
    const { error } = await supabase.from('project_columns').update(patch).eq('id', id)
    if (error) { showToast(error.message || 'Failed to update list', 'error'); return false }
    await fetchColumns()
    return true
  }, [fetchColumns])

  const deleteColumn = useCallback(async (id) => {
    const { error } = await supabase.from('project_columns').delete().eq('id', id)
    if (error) { showToast(error.message || 'Failed to delete list', 'error'); return false }
    await fetchColumns()
    return true
  }, [fetchColumns])

  return { columns, loading, addColumn, updateColumn, deleteColumn, refetch: fetchColumns }
}

// Features of a project = tasks tagged with project_id. Derived from the
// app-wide useTasks context so enrichment (sub-task counts, assignees, priority,
// unread) comes for free; the migration-108 RLS branch makes a member's
// project features visible in that fetch.
export function useProjectFeatures(projectId) {
  const { profile } = useAuth()
  const { tasks, refetch } = useTasks()
  const { assignTask } = useTaskActions()
  const { profiles } = useProfiles()

  const features = useMemo(
    () => tasks.filter(t => t.project_id === projectId),
    [tasks, projectId],
  )

  // Create a Feature = a self-assigned task tagged to the project + column.
  // Reuses assignTask (task_id generation, task_assignees, poke) rather than
  // re-implementing the insert.
  const addFeature = useCallback(async ({ title, columnId, urgency = 'Med', dueDate = null }) => {
    if (!profile?.id || !title?.trim()) return null
    const colFeatures = features.filter(f => f.project_column_id === columnId)
    const pos = colFeatures.length ? Math.max(...colFeatures.map(f => f.project_pos ?? 0)) + POS_STEP : POS_STEP
    const res = await assignTask({
      assigneeIds: [profile.id],
      title: title.trim(),
      urgency,
      dueDate,
      allProfiles: profiles,
      projectId,
      projectColumnId: columnId || null,
      projectPos: pos,
    })
    if (res?.ok) { await refetch(true) }
    else showToast(res?.msg || 'Failed to add feature', 'error')
    return res
  }, [profile?.id, features, profiles, assignTask, projectId, refetch])

  // Board move via SECURITY DEFINER RPC (any project member; syncs status if
  // the target list maps to one).
  const moveFeature = useCallback(async (taskId, columnId, pos) => {
    const { error } = await supabase.rpc('move_feature', { p_task: taskId, p_column: columnId, p_pos: pos })
    if (error) { showToast(error.message || 'Failed to move feature', 'error'); await refetch(true); return false }
    await refetch(true)
    return true
  }, [refetch])

  return { features, addFeature, moveFeature, refetch }
}
