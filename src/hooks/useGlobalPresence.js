import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const CHANNEL = 'pe-global-presence'

export function useGlobalPresence(profile) {
  const [presence, setPresence] = useState(() => new Map())

  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase.channel(CHANNEL, {
      config: { presence: { key: profile.id } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const next = new Map()
        for (const [userId, metas] of Object.entries(state)) {
          const latest = metas[metas.length - 1]
          next.set(userId, { online: true, onlineAt: latest?.online_at })
        }
        setPresence(next)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: profile.id,
            full_name: profile.full_name,
            avatar_url: profile.avatar_url,
            online_at: new Date().toISOString(),
          })
        }
      })

    return () => {
      channel.untrack()
      supabase.removeChannel(channel)
    }
  }, [profile?.id, profile?.full_name, profile?.avatar_url])

  return presence
}
