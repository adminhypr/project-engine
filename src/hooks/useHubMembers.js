import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from '../components/ui/index'

export function useHubMembers(hubId) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const hubRef = useRef(hubId)
  hubRef.current = hubId

  const fetchMembers = useCallback(async ({ silent = false } = {}) => {
    if (!hubRef.current) return
    const { data, error } = await supabase
      .from('hub_members')
      .select('*, profile:profiles!hub_members_profile_id_fkey(id, full_name, email, avatar_url, role)')
      .eq('hub_id', hubRef.current)
      .order('role', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) { if (!silent) showToast('Failed to load members', 'error') }
    setMembers(data || [])
    setLoading(false)
  }, [])

  // Initial fetch — guarded by `cancelled` so a rapid hub switch can't
  // land stale members on top of fresh state (or pop a toast for a fetch
  // the user already navigated away from).
  useEffect(() => {
    if (!hubId) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('hub_members')
        .select('*, profile:profiles!hub_members_profile_id_fkey(id, full_name, email, avatar_url, role)')
        .eq('hub_id', hubId)
        .order('role', { ascending: true })
        .order('created_at', { ascending: true })
      if (cancelled) return
      if (error) { setLoading(false); return }
      setMembers(data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [hubId])

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

  // Atomic owner swap via the SECURITY DEFINER RPC from migration 094.
  // Promotes newOwnerId to 'owner' and demotes the caller to 'admin' in
  // one transaction. Caller must be the current hub owner OR global Admin.
  const transferOwnership = useCallback(async (newOwnerId) => {
    const { error } = await supabase.rpc('transfer_hub_ownership', {
      p_hub_id: hubRef.current,
      p_new_owner_id: newOwnerId,
    })
    if (error) {
      console.error('transferOwnership failed:', error)
      showToast(error.message || 'Failed to transfer ownership', 'error')
      return false
    }
    showToast('Ownership transferred')
    return true
  }, [])

  // Self-leave. Backed by the existing hub_members_delete RLS clause
  // (profile_id = auth.uid()). The migration-094 last-owner guard
  // prevents the only remaining owner from leaving — UI should also
  // disable the button in that case for clarity, but the trigger is
  // the authoritative gate.
  const leaveHub = useCallback(async (myProfileId) => {
    const { error } = await supabase
      .from('hub_members')
      .delete()
      .eq('hub_id', hubRef.current)
      .eq('profile_id', myProfileId)
    if (error) {
      console.error('leaveHub failed:', error)
      // The last-owner guard raises with a clear message — surface it.
      showToast(error.message?.includes('last owner')
        ? 'Transfer ownership before leaving — you are the only owner.'
        : 'Failed to leave hub', 'error')
      return false
    }
    showToast('You left the hub')
    return true
  }, [])

  return { members, loading, addMember, removeMember, updateRole, transferOwnership, leaveHub, refetch: fetchMembers }
}
