import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useMentionNotifications() {
  const { profile } = useAuth()
  const [mentions, setMentions] = useState([])
  const [loading, setLoading]   = useState(true)

  const fetchMentions = useCallback(async () => {
    if (!profile?.id) return
    const { data } = await supabase
      .from('hub_mentions')
      .select(`
        id, hub_id, mentioned_by, entity_type, entity_id, seen, created_at,
        mentioner:profiles!hub_mentions_mentioned_by_fkey(full_name, avatar_url),
        hub:hubs!hub_mentions_hub_id_fkey(name)
      `)
      .eq('mentioned_user', profile.id)
      .eq('seen', false)
      .order('created_at', { ascending: false })
      .limit(20)
    setMentions(data || [])
    setLoading(false)
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) return
    fetchMentions()

    const channel = supabase
      .channel('hub-mentions-notif')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hub_mentions', filter: `mentioned_user=eq.${profile.id}` },
        () => fetchMentions()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.id, fetchMentions])

  const markSeen = useCallback(async (mentionId) => {
    await supabase.from('hub_mentions').update({ seen: true }).eq('id', mentionId)
    setMentions(prev => prev.filter(m => m.id !== mentionId))
  }, [])

  const markAllSeen = useCallback(async () => {
    if (mentions.length === 0) return
    const ids = mentions.map(m => m.id)
    await supabase.from('hub_mentions').update({ seen: true }).in('id', ids)
    setMentions([])
  }, [mentions])

  return { mentions, loading, markSeen, markAllSeen, refetch: fetchMentions }
}
