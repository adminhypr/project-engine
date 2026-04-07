import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

export function useHubEvents(hubId) {
  const { profile } = useAuth()
  const [events, setEvents]   = useState([])
  const [loading, setLoading] = useState(true)
  const hubRef = useRef(hubId)
  hubRef.current = hubId

  const fetchEvents = useCallback(async () => {
    if (!hubRef.current) return
    const start = new Date()
    start.setMonth(start.getMonth() - 1)
    const end = new Date()
    end.setMonth(end.getMonth() + 2)

    const { data, error } = await supabase
      .from('hub_events')
      .select('*, creator:profiles(id, full_name)')
      .eq('hub_id', hubRef.current)
      .gte('starts_at', start.toISOString())
      .lte('starts_at', end.toISOString())
      .order('starts_at', { ascending: true })
    if (error) showToast('Failed to load events', 'error')
    setEvents(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!hubId) return
    setLoading(true)
    setEvents([])
    fetchEvents()
  }, [hubId, fetchEvents])

  useEffect(() => {
    if (!hubId) return
    const channel = supabase
      .channel(`hub-events-${hubId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'hub_events', filter: `hub_id=eq.${hubId}` },
        () => fetchEvents()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [hubId, fetchEvents])

  const createEvent = useCallback(async ({ title, description, starts_at, ends_at, all_day, color }) => {
    if (!hubRef.current || !profile?.id) return false
    const { error } = await supabase.from('hub_events').insert({
      hub_id: hubRef.current,
      created_by: profile.id,
      title, description, starts_at, ends_at, all_day, color
    })
    if (error) { showToast('Failed to create event', 'error'); return false }
    await fetchEvents()
    return true
  }, [profile?.id, fetchEvents])

  const updateEvent = useCallback(async (eventId, updates) => {
    const { error } = await supabase.from('hub_events').update(updates).eq('id', eventId)
    if (error) { showToast('Failed to update event', 'error'); return false }
    await fetchEvents()
    return true
  }, [fetchEvents])

  const deleteEvent = useCallback(async (eventId) => {
    const { error } = await supabase.from('hub_events').delete().eq('id', eventId)
    if (error) showToast('Failed to delete event', 'error')
    await fetchEvents()
  }, [fetchEvents])

  return { events, loading, createEvent, updateEvent, deleteEvent, refetch: fetchEvents }
}
