import { useCallback, useMemo } from 'react'
import { useTaskActions } from './useTasks'
import { getChildren } from '../lib/subtasks'

// Lightweight wrapper. The caller passes in the live `tasks` array (from a
// page-level useTasks instance) so we don't spawn duplicate fetches /
// realtime channels per-panel. createSubtask delegates to assignTask with
// parentTaskId set, so RLS / audit / chat / participant seeding all reuse
// the existing task creation path.
export function useSubtasks(parentId, tasks = []) {
  const { assignTask } = useTaskActions()

  const children = useMemo(() => {
    return getChildren(parentId, tasks).sort((a, b) => {
      // Done rows sink to bottom; otherwise newest first.
      const aDone = a.status === 'Done' ? 1 : 0
      const bDone = b.status === 'Done' ? 1 : 0
      if (aDone !== bDone) return aDone - bDone
      const aDate = a.date_assigned || a.created_at || ''
      const bDate = b.date_assigned || b.created_at || ''
      return bDate.localeCompare(aDate)
    })
  }, [tasks, parentId])

  const createSubtask = useCallback(async (draft) => {
    if (!parentId) return { ok: false, msg: 'no parent id' }
    return assignTask({ ...draft, parentTaskId: parentId })
  }, [assignTask, parentId])

  return { children, createSubtask }
}
