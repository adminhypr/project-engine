import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { emitMessage } from '../lib/dmEventBus'

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
            .select('*, author:profiles!dm_messages_author_id_fkey(id, full_name, avatar_url)')
            .eq('id', payload.new.id)
            .maybeSingle()
          if (error || !data) return
          emitMessage(data.conversation_id, data)
        }
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [profileId])
}
