import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function usePresence(hubId, profile) {
  const [onlineUsers, setOnlineUsers] = useState([])

  useEffect(() => {
    if (!hubId || !profile) return

    const channel = supabase.channel(`hub-presence-${hubId}`, {
      config: { presence: { key: profile.id } }
    })

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState()
      const users = Object.values(state).map(arr => arr[0]).filter(Boolean)
      setOnlineUsers(users)
    })

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          user_id: profile.id,
          full_name: profile.full_name,
          avatar_url: profile.avatar_url || null,
          online_at: new Date().toISOString()
        })
      }
    })

    return () => {
      channel.untrack()
      supabase.removeChannel(channel)
    }
  }, [hubId, profile?.id])

  return { onlineUsers }
}
