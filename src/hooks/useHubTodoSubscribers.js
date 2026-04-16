import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

export function useHubTodoSubscribers(itemId) {
  const { profile } = useAuth()
  const [subscribers, setSubscribers] = useState([])
  const [loading, setLoading] = useState(true)
  const itemRef = useRef(itemId)
  itemRef.current = itemId

  const fetchSubs = useCallback(async () => {
    if (!itemRef.current) return
    const { data, error } = await supabase
      .from('hub_todo_item_subscribers')
      .select('profile_id, created_at, profile:profiles(id, full_name, avatar_url, email)')
      .eq('item_id', itemRef.current)
      .order('created_at')
    if (error) showToast('Failed to load subscribers', 'error')
    setSubscribers(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!itemId) return
    setLoading(true)
    setSubscribers([])
    fetchSubs()
  }, [itemId, fetchSubs])

  useEffect(() => {
    if (!itemId) return
    const channel = supabase
      .channel(`hub-todo-subs-${itemId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_todo_item_subscribers', filter: `item_id=eq.${itemId}` },
        () => fetchSubs()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [itemId, fetchSubs])

  const subscribe = useCallback(async (profileId) => {
    if (!itemRef.current) return false
    const target = profileId || profile?.id
    if (!target) return false
    const { error } = await supabase
      .from('hub_todo_item_subscribers')
      .insert({ item_id: itemRef.current, profile_id: target })
    if (error && !error.message.includes('duplicate key')) {
      showToast('Failed to subscribe', 'error'); return false
    }
    await fetchSubs()
    return true
  }, [profile?.id, fetchSubs])

  const unsubscribe = useCallback(async (profileId) => {
    if (!itemRef.current) return false
    const target = profileId || profile?.id
    if (!target) return false
    const { error } = await supabase
      .from('hub_todo_item_subscribers')
      .delete()
      .eq('item_id', itemRef.current)
      .eq('profile_id', target)
    if (error) { showToast('Failed to unsubscribe', 'error'); return false }
    await fetchSubs()
    return true
  }, [profile?.id, fetchSubs])

  const isSubscribed = subscribers.some(s => s.profile_id === profile?.id)

  return { subscribers, loading, isSubscribed, subscribe, unsubscribe }
}
