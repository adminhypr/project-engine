import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from '../components/ui/index'

export function useHubMembers(hubId) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const hubRef = useRef(hubId)
  hubRef.current = hubId

  const fetchMembers = useCallback(async () => {
    if (!hubRef.current) return
    const { data, error } = await supabase
      .from('hub_members')
      .select('*, profile:profiles!hub_members_profile_id_fkey(id, full_name, email, avatar_url, role)')
      .eq('hub_id', hubRef.current)
      .order('role', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) showToast('Failed to load members', 'error')
    setMembers(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!hubId) return
    setLoading(true)
    fetchMembers()
  }, [hubId, fetchMembers])

  // Realtime
  useEffect(() => {
    if (!hubId) return
    const channel = supabase
      .channel(`hub-members-${hubId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_members', filter: `hub_id=eq.${hubId}` },
        () => fetchMembers()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [hubId, fetchMembers])

  const addMember = useCallback(async (profileId, role = 'member') => {
    const { error } = await supabase.from('hub_members').insert({
      hub_id: hubRef.current,
      profile_id: profileId,
      role
    })
    if (error) {
      if (error.code === '23505') showToast('Already a member', 'error')
      else showToast('Failed to add member', 'error')
      return false
    }
    showToast('Member added')
    return true
  }, [])

  const removeMember = useCallback(async (profileId) => {
    const { error } = await supabase
      .from('hub_members')
      .delete()
      .eq('hub_id', hubRef.current)
      .eq('profile_id', profileId)
    if (error) { showToast('Failed to remove member', 'error'); return false }
    showToast('Member removed')
    return true
  }, [])

  const updateRole = useCallback(async (profileId, newRole) => {
    const { error } = await supabase
      .from('hub_members')
      .update({ role: newRole })
      .eq('hub_id', hubRef.current)
      .eq('profile_id', profileId)
    if (error) { showToast('Failed to update role', 'error'); return false }
    return true
  }, [])

  return { members, loading, addMember, removeMember, updateRole, refetch: fetchMembers }
}
