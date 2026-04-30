import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useMyHubTodos() {
  const { profile, activeTeamId } = useAuth()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchItems = useCallback(async () => {
    if (!profile?.id) { setItems([]); setLoading(false); return }
    setError(null)

    // Step 1: hub IDs the user is a member of AND whose team matches activeTeamId
    //         (custom hubs with team_id NULL are included only if the user is
    //          explicitly in hub_members — which is already enforced by RLS).
    const { data: memberships, error: mErr } = await supabase
      .from('hub_members')
      .select('hub_id, hubs!inner(id, name, team_id)')
      .eq('profile_id', profile.id)
    if (mErr) { setError(mErr); setLoading(false); return }

    const hubIds = (memberships || [])
      .filter(m => {
        const tid = m.hubs?.team_id
        // Team-scoped hubs: must match active workspace.
        // Custom hubs (tid null): always included.
        return !activeTeamId || tid == null || tid === activeTeamId
      })
      .map(m => m.hub_id)

    if (hubIds.length === 0) { setItems([]); setLoading(false); return }

    // Step 2: fetch items assigned to me in those hubs
    const { data, error: iErr } = await supabase
      .from('hub_todo_items')
      .select(`
        *,
        list:hub_todo_lists!hub_todo_items_list_id_fkey(id, title, color),
        hub:hubs!hub_todo_items_hub_id_fkey(id, name, team_id),
        creator:profiles!hub_todo_items_created_by_fkey(id, full_name, avatar_url),
        hub_todo_item_assignees!inner(profile_id, profiles!hub_todo_item_assignees_profile_id_fkey(id, full_name, avatar_url))
      `)
      .in('hub_id', hubIds)
      .is('deleted_at', null)
      .eq('hub_todo_item_assignees.profile_id', profile.id)
      .order('due_date', { ascending: true, nullsFirst: false })

    if (iErr) setError(iErr)
    setItems(data || [])
    setLoading(false)
  }, [profile?.id, activeTeamId])

  // Initial fetch — guarded by `cancelled` so a rapid workspace
  // (activeTeamId) switch can't land stale items on top of fresh state.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      if (!profile?.id) { if (!cancelled) { setItems([]); setLoading(false) } ; return }
      setError(null)

      const { data: memberships, error: mErr } = await supabase
        .from('hub_members')
        .select('hub_id, hubs!inner(id, name, team_id)')
        .eq('profile_id', profile.id)
      if (cancelled) return
      if (mErr) { setError(mErr); setLoading(false); return }

      const hubIds = (memberships || [])
        .filter(m => {
          const tid = m.hubs?.team_id
          return !activeTeamId || tid == null || tid === activeTeamId
        })
        .map(m => m.hub_id)

      if (hubIds.length === 0) { setItems([]); setLoading(false); return }

      const { data, error: iErr } = await supabase
        .from('hub_todo_items')
        .select(`
          *,
          list:hub_todo_lists!hub_todo_items_list_id_fkey(id, title, color),
          hub:hubs!hub_todo_items_hub_id_fkey(id, name, team_id),
          creator:profiles!hub_todo_items_created_by_fkey(id, full_name, avatar_url),
          hub_todo_item_assignees!inner(profile_id, profiles!hub_todo_item_assignees_profile_id_fkey(id, full_name, avatar_url))
        `)
        .in('hub_id', hubIds)
        .is('deleted_at', null)
        .eq('hub_todo_item_assignees.profile_id', profile.id)
        .order('due_date', { ascending: true, nullsFirst: false })

      if (cancelled) return
      if (iErr) setError(iErr)
      setItems(data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [profile?.id, activeTeamId])

  // Realtime: any change in hub_todo_items triggers a refetch.
  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase.channel(`my-hub-todos-${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hub_todo_items' }, () => fetchItems())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hub_todo_item_assignees' }, () => fetchItems())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.id, fetchItems])

  return { items, loading, error, refetch: fetchItems }
}
