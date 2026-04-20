import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Tracks the other participant's last_read_at for a conversation, with a
// realtime subscription so "Seen" status updates live.
// Returns ISO string or null if not yet loaded.
export function useOtherReadState(conversationId, otherUserId) {
  const [lastReadAt, setLastReadAt] = useState(null)

  useEffect(() => {
    if (!conversationId || !otherUserId) {
      setLastReadAt(null)
      return
    }
    let alive = true
    supabase
      .from('conversation_participants')
      .select('last_read_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', otherUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (alive && data) setLastReadAt(data.last_read_at)
      })

    const channel = supabase
      .channel(`pe-dm-read-${conversationId}-${otherUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversation_participants',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (payload.new?.user_id === otherUserId && payload.new?.last_read_at) {
            setLastReadAt(payload.new.last_read_at)
          }
        }
      )
      .subscribe()

    return () => {
      alive = false
      supabase.removeChannel(channel)
    }
  }, [conversationId, otherUserId])

  return lastReadAt
}
