import { useState, useEffect, useId } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// How far back to look for assignments to surface in the bell.
// Older entries are still in the DB (and digest can email them) but the
// bell only shows recent stuff.
const LOOKBACK_DAYS = 7

// Real-time bell feed of "X assigned you a to-do" within the last week.
// Mirrors the shape of useMentionNotifications: returns a flat array
// the NotificationBell renders into entries. Self-assignments and rows
// pointing at deleted items are filtered out.
//
// Backed by hub_todo_item_assignees + the assigned_by column added in
// migration 090. Existing rows from before 090 have assigned_by=NULL
// and are silently skipped — there's no reliable way to recover the
// historic assigner, and 7 days of lookback means they age out of the
// window quickly.
export function useTodoAssignmentNotifications() {
  const { profile } = useAuth()
  const [items, setItems] = useState([])
  const instanceId = useId()

  useEffect(() => {
    if (!profile?.id) {
      setItems([])
      return
    }
    let cancelled = false

    async function fetch() {
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('hub_todo_item_assignees')
        .select(`
          id, item_id, profile_id, assigned_by, created_at,
          item:hub_todo_items!hub_todo_item_assignees_item_id_fkey(
            id, title, hub_id, list_id, deleted_at,
            list:hub_todo_lists!hub_todo_items_list_id_fkey(id, title),
            hub:hubs!hub_todo_items_hub_id_fkey(id, name)
          ),
          assigner:profiles!hub_todo_item_assignees_assigned_by_fkey(id, full_name, avatar_url)
        `)
        .eq('profile_id', profile.id)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(20)

      if (cancelled) return
      if (error) { setItems([]); return }
      const filtered = (data || []).filter((r) =>
        r.item &&
        !r.item.deleted_at &&
        r.assigned_by &&
        r.assigned_by !== profile.id
      )
      setItems(filtered)
    }

    fetch()

    const ch = supabase
      .channel(`todo-assign-notif:${profile.id}:${instanceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'hub_todo_item_assignees',
          filter: `profile_id=eq.${profile.id}`,
        },
        () => fetch(),
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(ch)
    }
  }, [profile?.id, instanceId])

  return items
}
