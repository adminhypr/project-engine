import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui'
import { onMessage } from '../lib/dmEventBus'
import { useDocumentVisible } from '../lib/useDocumentVisible'

// Same select shape as useConversation — keeps row shapes identical so UI
// primitives (MessageList etc.) work on either kind of conversation.
const MSG_SELECT =
  '*, author:profiles!dm_messages_author_id_fkey(id, full_name, avatar_url), reply_to_author:profiles!dm_messages_reply_to_author_id_fkey(id, full_name)'

/**
 * useTaskChat — kind='task' analogue of useConversation, keyed by task id.
 *
 * On mount, resolves (and enrols caller in) the conversation for the task
 * via the ensure_task_chat_participant RPC (first-visit enrolment; idempotent
 * for existing participants). Then fetches root messages, reacts to realtime
 * inserts via the shared dmEventBus (fed by useDmRealtime), and exposes
 * sendMessage / markRead.
 *
 * Mirrors useConversation's insert shape exactly — real dm_messages columns
 * (mentions jsonb, inline_images jsonb; NOT mentioned_profile_ids/attachments
 * which the plan text incorrectly suggested).
 */
export function useTaskChat(taskId) {
  const { profile } = useAuth()
  const [conversationId, setConversationId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const cidRef = useRef(null)
  cidRef.current = conversationId

  // 1. Resolve + enrol.
  useEffect(() => {
    if (!taskId || !profile?.id) {
      setConversationId(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase.rpc('ensure_task_chat_participant', { tid: taskId })
      if (cancelled) return
      if (error) {
        console.error('ensure_task_chat_participant failed:', error)
        setLoading(false)
        return
      }
      setConversationId(data)
    })()
    return () => { cancelled = true }
  }, [taskId, profile?.id])

  // 2. Fetch root messages whenever the conversation is known.
  const fetchMessages = useCallback(async () => {
    const cid = cidRef.current
    if (!cid) return
    const { data, error } = await supabase
      .from('dm_messages')
      .select(MSG_SELECT)
      .eq('conversation_id', cid)
      // Exclude thread replies — they render in the ThreadPanel only. Same
      // rule as useConversation; column is provided by migration 037.
      .is('thread_root_id', null)
      .order('created_at', { ascending: true })
    if (error) { showToast('Failed to load messages', 'error'); return }
    setMessages(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!conversationId) return
    fetchMessages()
  }, [conversationId, fetchMessages])

  // 3. Realtime — subscribe to the shared bus (fed by the global
  //    useDmRealtime subscription mounted in AuthProvider). This is the same
  //    pattern useConversation uses; avoids a second per-conversation
  //    postgres_changes channel.
  useEffect(() => {
    if (!conversationId) return
    return onMessage(({ conversationId: cid, message }) => {
      if (cid !== conversationId) return
      if (message.thread_root_id) return
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev
        return [...prev, message]
      })
    })
  }, [conversationId])

  // Tab-wake resync — mirrors useConversation. If the realtime socket was
  // asleep while the tab was hidden, a bus event may have been missed;
  // refetch root messages so the task panel catches up on visible.
  //
  // Importantly, MERGE by id rather than replace the array. Replacing
  // gives every existing message a new object identity and re-renders
  // the entire chat thread on every tab return — exactly the "task page
  // refreshes when I switch back" complaint.
  const resync = useCallback(async () => {
    const cid = cidRef.current
    if (!cid) return
    const { data, error } = await supabase
      .from('dm_messages')
      .select(MSG_SELECT)
      .eq('conversation_id', cid)
      .is('thread_root_id', null)
      .order('created_at', { ascending: true })
    if (error || !data) return
    setMessages(prev => {
      if (prev.length === 0) return data
      const byId = new Map(prev.map(m => [m.id, m]))
      let changed = false
      for (const m of data) {
        if (!byId.has(m.id)) { byId.set(m.id, m); changed = true }
      }
      if (!changed) return prev
      return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
    })
  }, [])
  useDocumentVisible(resync)

  // 4. Send — object signature per plan Task 4, insert shape per
  //    useConversation (real columns: mentions, inline_images, reply_to_*).
  const sendMessage = useCallback(async ({ body, mentions = [], inline_images = [], reply_to_id = null, reply_to_author_id = null, reply_to_preview = null } = {}) => {
    const cid = cidRef.current
    if (!cid || !profile?.id) return { data: null, error: new Error('not ready') }
    const trimmed = (body || '').trim()
    const hasImages = Array.isArray(inline_images) && inline_images.length > 0
    if (!trimmed && !hasImages) return { data: null, error: new Error('empty message') }
    const { data, error } = await supabase
      .from('dm_messages')
      .insert({
        conversation_id: cid,
        author_id: profile.id,
        kind: 'user',
        content: trimmed,
        inline_images: inline_images.map(({ preview, ...rest }) => rest),
        mentions: Array.isArray(mentions) ? mentions : [],
        reply_to_id: reply_to_id || null,
        reply_to_author_id: reply_to_author_id || null,
        reply_to_preview: reply_to_preview || null,
      })
      .select(MSG_SELECT)
      .single()
    if (error || !data) { showToast('Failed to send message', 'error'); return { data: null, error } }
    // Optimistic append — realtime echo dedup'd by id in the bus handler above.
    setMessages(prev => (prev.some(m => m.id === data.id) ? prev : [...prev, data]))
    return { data, error: null }
  }, [profile?.id])

  const markRead = useCallback(async () => {
    const cid = cidRef.current
    if (!cid) return
    await supabase.rpc('mark_conversation_read', { cid })
  }, [])

  return { conversationId, messages, loading, sendMessage, markRead, refetch: fetchMessages }
}
