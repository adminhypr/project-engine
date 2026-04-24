// src/hooks/useTaskAssigneeCompletion.js
import { useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useTaskAssigneeCompletion() {
  const { profile, isAdmin } = useAuth()

  const markSelfComplete = useCallback(async (taskId) => {
    if (!profile?.id) return { error: new Error('not authed') }
    const { error } = await supabase
      .from('task_assignees')
      .update({ completed_at: new Date().toISOString(), completed_by: profile.id })
      .eq('task_id', taskId)
      .eq('profile_id', profile.id)
    return { error }
  }, [profile?.id])

  const unmarkSelf = useCallback(async (taskId) => {
    if (!profile?.id) return { error: new Error('not authed') }
    const { error } = await supabase
      .from('task_assignees')
      .update({ completed_at: null, completed_by: null })
      .eq('task_id', taskId)
      .eq('profile_id', profile.id)
    return { error }
  }, [profile?.id])

  // Admin / assigner toggling another assignee's row.
  const setAssigneeCompletion = useCallback(async (taskId, profileId, completed) => {
    if (!profile?.id) return { error: new Error('not authed') }
    const payload = completed
      ? { completed_at: new Date().toISOString(), completed_by: profile.id }
      : { completed_at: null, completed_by: null }
    const { error } = await supabase
      .from('task_assignees')
      .update(payload)
      .eq('task_id', taskId)
      .eq('profile_id', profileId)
    return { error }
  }, [profile?.id])

  const forceClose = useCallback(async (taskId) => {
    const { error } = await supabase.rpc('force_close_task', { tid: taskId })
    return { error }
  }, [])

  return { markSelfComplete, unmarkSelf, setAssigneeCompletion, forceClose, isAdmin }
}
