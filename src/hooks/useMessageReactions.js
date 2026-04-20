import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui'
import { aggregateReactions, toggleReactionRow } from '../lib/reactionAggregation'

/**
 * Subscribes to dm_message_reactions for every message in the given
 * conversation and returns per-message aggregated reactions plus a
 * toggle() action.
 *
 * We cannot filter realtime by a joined column (conversation_id lives
 * on dm_messages, not on dm_message_reactions), so we subscribe
 * unfiltered and drop events whose message_id isn't in the list of
 * messages for this conversation. The list is maintained via a single
 * re-fetch on each change — simple, consistent with the rest of the
 * app's "refetch on realtime" pattern.
 */
export function useMessageReactions(conversationId) {
  const { profile } = useAuth()
  const myId = profile?.id || null
  const [rows, setRows] = useState([])
  const messageIdsRef = useRef(new Set())
  const cidRef = useRef(conversationId)
  cidRef.current = conversationId

  const refetch = useCallback(async () => {
    if (!cidRef.current) { setRows([]); return }
    // Fetch message ids for the conversation, then reactions for those ids.
    // Two round-trips is cheaper and clearer than a nested PostgREST join,
    // and keeps RLS boundaries easy to reason about.
    const { data: msgs, error: mErr } = await supabase
      .from('dm_messages')
      .select('id')
      .eq('conversation_id', cidRef.current)
    if (mErr) { showToast('Failed to load reactions', 'error'); return }
    const ids = (msgs || []).map(m => m.id)
    messageIdsRef.current = new Set(ids)
    if (ids.length === 0) { setRows([]); return }
    const { data: rx, error: rErr } = await supabase
      .from('dm_message_reactions')
      .select('message_id, user_id, emoji')
      .in('message_id', ids)
    if (rErr) { showToast('Failed to load reactions', 'error'); return }
    setRows(rx || [])
  }, [])

  useEffect(() => {
    if (!conversationId) { setRows([]); messageIdsRef.current = new Set(); return }
    refetch()
  }, [conversationId, refetch])

  // Realtime: watch all reaction INSERT/DELETE events and filter client-side
  // to this conversation by checking the message_id against the known set.
  // When a new DM message arrives, its id won't be in messageIdsRef yet —
  // that's fine: reactions can't exist on a brand-new message before the
  // author even sees it. We refresh the id set lazily on the next refetch().
  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`dm-reactions-${conversationId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_message_reactions' },
        (payload) => {
          const r = payload.new
          if (!r || !messageIdsRef.current.has(r.message_id)) return
          setRows(prev => {
            if (prev.some(x =>
              x.message_id === r.message_id &&
              x.user_id === r.user_id &&
              x.emoji === r.emoji
            )) return prev
            return [...prev, { message_id: r.message_id, user_id: r.user_id, emoji: r.emoji }]
          })
        }
      )
      .on('postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'dm_message_reactions' },
        (payload) => {
          const r = payload.old
          if (!r) return
          // DELETE payloads may omit message_id if the row key fields aren't
          // in the replica identity; we just filter whatever we have.
          setRows(prev => prev.filter(x =>
            !(x.message_id === r.message_id &&
              x.user_id === r.user_id &&
              x.emoji === r.emoji)
          ))
        }
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [conversationId])

  const byMessageId = useMemo(() => aggregateReactions(rows, myId), [rows, myId])

  const toggle = useCallback(async (messageId, emoji) => {
    if (!myId || !messageId || !emoji) return
    const has = rows.some(r =>
      r.message_id === messageId && r.user_id === myId && r.emoji === emoji
    )
    // Optimistic flip
    setRows(prev => toggleReactionRow(prev, messageId, myId, emoji))
    if (has) {
      const { error } = await supabase
        .from('dm_message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', myId)
        .eq('emoji', emoji)
      if (error) {
        showToast('Failed to remove reaction', 'error')
        setRows(prev => toggleReactionRow(prev, messageId, myId, emoji)) // revert
      }
    } else {
      const { error } = await supabase
        .from('dm_message_reactions')
        .insert({ message_id: messageId, user_id: myId, emoji })
      if (error) {
        showToast('Failed to add reaction', 'error')
        setRows(prev => toggleReactionRow(prev, messageId, myId, emoji)) // revert
      }
    }
    // Keep message-id set fresh (handles reactions on newly-arrived messages).
    messageIdsRef.current.add(messageId)
  }, [rows, myId])

  return { byMessageId, toggle }
}
