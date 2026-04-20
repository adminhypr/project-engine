import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { emitMessage } from '../lib/dmEventBus'
import { playMessageSound } from '../lib/notificationSounds'

export function useDmRealtime(profileId) {
  useEffect(() => {
    if (!profileId) return

    const channel = supabase
      .channel(`pe-dm-global-${profileId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages' },
        async (payload) => {
          const { data, error } = await supabase
            .from('dm_messages')
            .select('*, author:profiles!dm_messages_author_id_fkey(id, full_name, avatar_url), reply_to_author:profiles!dm_messages_reply_to_author_id_fkey(id, full_name)')
            .eq('id', payload.new.id)
            .maybeSingle()
          if (error || !data) return
          emitMessage(data.conversation_id, data)
          // Sound for incoming user messages only — not my own sends,
          // not system messages (task assignments etc. use the task sound).
          if (data.author_id !== profileId && data.kind !== 'system') {
            playMessageSound()
          }
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [profileId])
}
