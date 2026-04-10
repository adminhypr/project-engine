import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { showToast } from '../components/ui/index'

const PAGE_SIZE = 30

export function useHubActivity(hubId) {
  const [activities, setActivities] = useState([])
  const [loading, setLoading]       = useState(true)
  const [hasMore, setHasMore]       = useState(true)
  const hubRef = useRef(hubId)
  hubRef.current = hubId

  const fetchActivities = useCallback(async (cursor) => {
    if (!hubRef.current) return []
    let query = supabase
      .from('hub_activity')
      .select('*, actor:profiles!hub_activity_actor_id_fkey(id, full_name, avatar_url)')
      .eq('hub_id', hubRef.current)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (cursor) query = query.lt('created_at', cursor)
    const { data, error } = await query
    if (error) { showToast('Failed to load activity', 'error'); return [] }
    return data || []
  }, [])

  useEffect(() => {
    if (!hubId) return
    setLoading(true)
    setActivities([])
    setHasMore(true)
    fetchActivities().then(data => {
      setActivities(data)
      setHasMore(data.length === PAGE_SIZE)
      setLoading(false)
    })
  }, [hubId, fetchActivities])

  useEffect(() => {
    if (!hubId) return
    const channel = supabase
      .channel(`hub-activity-${hubId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hub_activity', filter: `hub_id=eq.${hubId}` },
        async (payload) => {
          const { data } = await supabase
            .from('hub_activity')
            .select('*, actor:profiles!hub_activity_actor_id_fkey(id, full_name, avatar_url)')
            .eq('id', payload.new.id)
            .single()
          if (data) setActivities(prev => [data, ...prev])
        }
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [hubId])

  const loadMore = useCallback(async () => {
    if (!hasMore || activities.length === 0) return
    const cursor = activities[activities.length - 1].created_at
    const data = await fetchActivities(cursor)
    setActivities(prev => [...prev, ...data])
    setHasMore(data.length === PAGE_SIZE)
  }, [hasMore, activities, fetchActivities])

  return { activities, loading, loadMore, hasMore }
}
