import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

export function useHubs() {
  const { profile } = useAuth()
  const [hubs, setHubs]       = useState([])
  const [loading, setLoading] = useState(true)

  const fetchHubs = useCallback(async () => {
    if (!profile?.id) return
    const { data, error } = await supabase
      .from('hubs')
      .select('*, hub_members!inner(profile_id, role)')
      .eq('hub_members.profile_id', profile.id)
      .order('created_at', { ascending: false })
    if (error) { showToast('Failed to load hubs', 'error'); return }

    // Enrich with member count and user's role
    const enriched = await Promise.all((data || []).map(async hub => {
      const { count } = await supabase
        .from('hub_members')
        .select('*', { count: 'exact', head: true })
        .eq('hub_id', hub.id)
      const myRole = hub.hub_members?.find(m => m.profile_id === profile.id)?.role || 'member'
      return { ...hub, member_count: count || 0, my_role: myRole, hub_members: undefined }
    }))

    setHubs(enriched)
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    fetchHubs()
  }, [fetchHubs])

  const createHub = useCallback(async ({ name, description, icon, color }) => {
    if (!profile?.id || !name.trim()) return null
    // Create hub
    const { data: hub, error } = await supabase
      .from('hubs')
      .insert({ name: name.trim(), description: description?.trim() || null, icon, color, created_by: profile.id })
      .select()
      .single()
    if (error) { showToast('Failed to create hub', 'error'); return null }

    // Add creator as owner
    await supabase.from('hub_members').insert({
      hub_id: hub.id,
      profile_id: profile.id,
      role: 'owner'
    })

    await fetchHubs()
    showToast('Hub created')
    return hub
  }, [profile?.id, fetchHubs])

  const updateHub = useCallback(async (hubId, updates) => {
    const { error } = await supabase.from('hubs').update(updates).eq('id', hubId)
    if (error) { showToast('Failed to update hub', 'error'); return false }
    await fetchHubs()
    return true
  }, [fetchHubs])

  const deleteHub = useCallback(async (hubId) => {
    const { error } = await supabase.from('hubs').delete().eq('id', hubId)
    if (error) { showToast('Failed to delete hub', 'error'); return false }
    await fetchHubs()
    showToast('Hub deleted')
    return true
  }, [fetchHubs])

  return { hubs, loading, createHub, updateHub, deleteHub, refetch: fetchHubs }
}
