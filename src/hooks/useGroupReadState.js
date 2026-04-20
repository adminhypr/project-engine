import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// For a group conversation, fetch every participant's last_read_at and keep
// it live via postgres_changes on conversation_participants. Returns an
// array of { user_id, last_read_at, profile } where profile comes from the
// passed-in conversation.participants list (so no extra profile fetch).
//
// Disabled for 1:1 DMs (the single-reader version is useOtherReadState).
export function useGroupReadState(conversationId, participants) {
  const [readers, setReaders] = useState([])

  useEffect(() => {
    if (!conversationId || !participants || participants.length === 0) {
      setReaders([])
      return
    }

    const profileById = new Map(participants.map(p => [p.id, p]))
    let alive = true

    supabase
      .from('conversation_participants')
      .select('user_id, last_read_at')
      .eq('conversation_id', conversationId)
      .then(({ data }) => {
        if (!alive || !data) return
        setReaders(data
          .filter(r => profileById.has(r.user_id))
          .map(r => ({
            user_id: r.user_id,
            last_read_at: r.last_read_at,
            profile: profileById.get(r.user_id),
          }))
        )
      })

    const channel = supabase
      .channel(`pe-group-read-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversation_participants',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new
          if (!row || !row.user_id || !row.last_read_at) return
          if (!profileById.has(row.user_id)) return
          setReaders(prev => {
            const idx = prev.findIndex(r => r.user_id === row.user_id)
            const next = { user_id: row.user_id, last_read_at: row.last_read_at, profile: profileById.get(row.user_id) }
            if (idx < 0) return [...prev, next]
            const copy = prev.slice()
            copy[idx] = next
            return copy
          })
        }
      )
      .subscribe()

    return () => {
      alive = false
      supabase.removeChannel(channel)
    }
    // `participants` is reference-stable enough for this purpose — any change
    // in the participant set (add/remove) rebuilds `conversation` upstream
    // and passes a new array.
  }, [conversationId, participants])

  return readers
}
