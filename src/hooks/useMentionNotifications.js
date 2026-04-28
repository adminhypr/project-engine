import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { onMessage } from '../lib/dmEventBus'

// Returns a unified mention list combining:
//   - hub_mentions rows (existing notification table, per-mention seen flag)
//   - dm_messages where the viewer is in the mentions jsonb array AND the
//     conversation is kind='task' (seen-tracking via the conversation's
//     last_read_at; no per-mention seen row).
//
// Shape returned to consumers:
//   { id, source: 'hub' | 'task_chat', ...fields used by NotificationBell }
//
// hub source keeps the original fields (hub_id, entity_type, mentioner, hub, seen, mentionId-equivalent id).
// task_chat source adds: conversation_id, task_id, task_title, author, content.

export function useMentionNotifications() {
  const { profile } = useAuth()
  const [hubMentions, setHubMentions] = useState([])
  const [taskMentions, setTaskMentions] = useState([])
  const [loading, setLoading] = useState(true)
  // Track last_read_at per task-chat conversation so we can filter out
  // mentions the viewer has already seen by opening the chat.
  const readMapRef = useRef(new Map()) // conversation_id -> last_read_at ISO

  const fetchHubMentions = useCallback(async () => {
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
    setHubMentions(data || [])
  }, [profile?.id])

  const fetchTaskMentions = useCallback(async () => {
    if (!profile?.id) return

    // 1. dm_messages where I'm mentioned (jsonb contains this user_id).
    //    Filter by conversation kind='task' via the inner join.
    //
    //    Note: supabase-js's .contains() does Array.join(',') for arrays,
    //    which produces "[object Object]" for arrays of objects. For jsonb
    //    containment we have to hand it a pre-serialized JSON string.
    const { data: msgs } = await supabase
      .from('dm_messages')
      .select(`
        id, conversation_id, author_id, content, created_at,
        conversation:conversations!inner(id, kind, task_id),
        author:profiles!dm_messages_author_id_fkey(full_name, avatar_url)
      `)
      .filter('mentions', 'cs', JSON.stringify([{ user_id: profile.id }]))
      .eq('conversation.kind', 'task')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20)

    const rows = msgs || []
    if (rows.length === 0) { setTaskMentions([]); return }

    // 2. Get my last_read_at for each conversation so we can mark mentions
    //    as "seen" once I've opened the task chat past that message.
    const convIds = [...new Set(rows.map(r => r.conversation_id))]
    const { data: parts } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', profile.id)
      .in('conversation_id', convIds)

    const readMap = new Map()
    ;(parts || []).forEach(p => { if (p.last_read_at) readMap.set(p.conversation_id, p.last_read_at) })
    readMapRef.current = readMap

    // 3. Get task titles (and filter out soft-deleted tasks implicitly via RLS).
    const taskIds = [...new Set(rows.map(r => r.conversation?.task_id).filter(Boolean))]
    let titleMap = new Map()
    if (taskIds.length > 0) {
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title')
        .in('id', taskIds)
      ;(tasks || []).forEach(t => titleMap.set(t.id, t.title))
    }

    // 4. Filter out mentions already seen (message older than last_read_at).
    const unseen = rows.filter(r => {
      const lastRead = readMap.get(r.conversation_id)
      if (!lastRead) return true
      return new Date(r.created_at) > new Date(lastRead)
    }).map(r => ({
      id: r.id,
      conversation_id: r.conversation_id,
      task_id: r.conversation?.task_id,
      task_title: titleMap.get(r.conversation?.task_id) || 'Task',
      author: r.author,
      content: r.content,
      created_at: r.created_at,
    }))

    setTaskMentions(unseen)
  }, [profile?.id])

  const fetchAll = useCallback(async () => {
    await Promise.all([fetchHubMentions(), fetchTaskMentions()])
    setLoading(false)
  }, [fetchHubMentions, fetchTaskMentions])

  useEffect(() => {
    if (!profile?.id) return
    fetchAll()

    const hubChannel = supabase
      .channel('hub-mentions-notif')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'hub_mentions', filter: `mentioned_user=eq.${profile.id}` },
        () => fetchHubMentions()
      )
      .subscribe()

    // Any new dm_message MAY be a task-chat mention of me. Cheap pre-check:
    // the message payload carries a `mentions` jsonb array of
    // `{user_id, display_name}` entries — if my id isn't there, skip the
    // (4-table) refetch entirely. Without this guard, every DM in the
    // workspace triggered a fetchTaskMentions, which is the most common
    // source of "the page just refreshed for no reason" complaints.
    const offDm = onMessage(({ message }) => {
      const mentions = Array.isArray(message?.mentions) ? message.mentions : []
      const mentionsMe = mentions.some(m => (m?.user_id || m?.id) === profile.id)
      if (!mentionsMe) return
      fetchTaskMentions()
    })

    // When the viewer opens a task chat, mark_conversation_read updates
    // their last_read_at. Subscribe to their conversation_participants
    // UPDATE events to prune seen mentions live.
    const partChannel = supabase
      .channel('task-mentions-read')
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${profile.id}` },
        () => fetchTaskMentions()
      )
      .subscribe()

    return () => {
      supabase.removeChannel(hubChannel)
      supabase.removeChannel(partChannel)
      offDm()
    }
  }, [profile?.id, fetchAll, fetchHubMentions, fetchTaskMentions])

  const markSeen = useCallback(async (mentionId) => {
    // Only hub mentions have a per-row seen flag. Task chat mentions get
    // cleared implicitly when the viewer opens the chat (last_read_at).
    await supabase.from('hub_mentions').update({ seen: true }).eq('id', mentionId)
    setHubMentions(prev => prev.filter(m => m.id !== mentionId))
  }, [])

  const markAllSeen = useCallback(async () => {
    if (hubMentions.length === 0) return
    const ids = hubMentions.map(m => m.id)
    await supabase.from('hub_mentions').update({ seen: true }).in('id', ids)
    setHubMentions([])
  }, [hubMentions])

  return {
    // Legacy field kept for backward compat with any consumer reading `mentions`
    // (it was the hub_mentions list). Now it's the combined list tagged with `source`.
    mentions: [
      ...hubMentions.map(m => ({ ...m, source: 'hub' })),
      ...taskMentions.map(m => ({ ...m, source: 'task_chat' })),
    ],
    hubMentions,
    taskMentions,
    loading,
    markSeen,
    markAllSeen,
    refetch: fetchAll,
  }
}
