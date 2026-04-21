import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// For the currently loaded main-stream messages, fetch each message's
// thread reply count + latest reply timestamp (only for messages that
// actually have replies). Kept live via a single realtime subscription
// on dm_messages INSERT/UPDATE — anything with a thread_root_id that
// matches a loaded root triggers a light reload of that root's count.
//
// Returns Map<rootMessageId, { count, lastReplyAt }>.
export function useThreadCounts(conversationId, messageIds) {
  const [counts, setCounts] = useState(() => new Map())

  // Sort + stringify so the effect fires only on actual set changes.
  const idsKey = useMemo(
    () => [...(messageIds || [])].sort().join(','),
    [messageIds]
  )

  useEffect(() => {
    if (!conversationId || !messageIds || messageIds.length === 0) {
      setCounts(new Map())
      return
    }
    let alive = true

    async function refresh() {
      const { data, error } = await supabase.rpc('dm_thread_counts', { root_ids: messageIds })
      if (!alive || error) return
      const next = new Map()
      for (const row of data || []) {
        next.set(row.thread_root_id, {
          count: Number(row.reply_count) || 0,
          lastReplyAt: row.last_reply_at,
        })
      }
      setCounts(next)
    }
    refresh()

    const knownRootIds = new Set(messageIds)
    const channel = supabase
      .channel(`pe-thread-counts-${conversationId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages' },
        (payload) => {
          const row = payload.new
          if (row?.thread_root_id && knownRootIds.has(row.thread_root_id)) refresh()
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'dm_messages' },
        (payload) => {
          // Soft-delete of a reply changes the count.
          const row = payload.new
          if (row?.thread_root_id && knownRootIds.has(row.thread_root_id)) refresh()
        })
      .subscribe()

    return () => { alive = false; supabase.removeChannel(channel) }
    // idsKey + conversationId drive the realtime channel scope + refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, conversationId])

  return counts
}
