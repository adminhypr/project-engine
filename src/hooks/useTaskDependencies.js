import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// Loads the dependency rows for a single task in both directions:
//   blockers — tasks blocking THIS task (rows where blocked_id = taskId)
//   blocked  — tasks blocked BY this task (rows where blocker_id = taskId)
//
// Subscribes to realtime changes on `task_dependencies` and refetches.
// Returns plain dependency rows (blocker_id / blocked_id / created_*); the
// caller resolves task data from its own `tasks` array (avoids fan-out
// queries here and keeps the hook independent of useTasks subscriptions).
export function useTaskDependencies(taskId) {
  const { profile } = useAuth()
  const [blockers, setBlockers] = useState([])
  const [blocked, setBlocked]   = useState([])
  const [loading, setLoading]   = useState(true)
  const taskIdRef = useRef(taskId)
  taskIdRef.current = taskId

  const fetchAll = useCallback(async () => {
    const tid = taskIdRef.current
    if (!tid) { setBlockers([]); setBlocked([]); setLoading(false); return }
    setLoading(true)
    const [blockersRes, blockedRes] = await Promise.all([
      supabase.from('task_dependencies').select('*').eq('blocked_id', tid),
      supabase.from('task_dependencies').select('*').eq('blocker_id', tid),
    ])
    if (!blockersRes.error) setBlockers(blockersRes.data || [])
    if (!blockedRes.error)  setBlocked(blockedRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [taskId, fetchAll])

  // Realtime — refetch on any change to task_dependencies. Filtered
  // client-side because postgres_changes filters on composite PKs are
  // unreliable (same gotcha called out in useTasks).
  useEffect(() => {
    if (!taskId) return
    const ch = supabase
      .channel(`task-deps-${taskId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_dependencies' }, (payload) => {
        const row = payload.new || payload.old
        if (!row) return
        if (row.blocker_id === taskId || row.blocked_id === taskId) {
          fetchAll()
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [taskId, fetchAll])

  const addBlocker = useCallback(async (blockerId) => {
    if (!profile?.id || !taskId) return { error: new Error('not ready') }
    if (blockerId === taskId) return { error: new Error('self-dependency') }
    const { error } = await supabase
      .from('task_dependencies')
      .insert({ blocker_id: blockerId, blocked_id: taskId, created_by: profile.id })
    if (!error) fetchAll()
    return { error }
  }, [profile?.id, taskId, fetchAll])

  const removeBlocker = useCallback(async (blockerId) => {
    if (!taskId) return { error: new Error('no task') }
    const { error } = await supabase
      .from('task_dependencies')
      .delete()
      .eq('blocker_id', blockerId)
      .eq('blocked_id', taskId)
    if (!error) fetchAll()
    return { error }
  }, [taskId, fetchAll])

  return { blockers, blocked, loading, addBlocker, removeBlocker, refetch: fetchAll }
}
