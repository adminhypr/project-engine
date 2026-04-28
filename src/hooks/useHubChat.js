import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'
import { useDocumentVisible } from '../lib/useDocumentVisible'
import { onMessage as onDmMessage } from '../lib/dmEventBus'

const PAGE_SIZE = 50

const MSG_SELECT =
  '*, author:profiles!dm_messages_author_id_fkey(id, full_name, avatar_url)'

// Hub Campfire chat. Migration 066 made campfires module-scoped — each
// 'campfire' kind row in hub_modules maps to one kind='hub' conversation
// in the conversations table. This hook resolves the conversation id from
// the module id (via get_hub_module_conversation), then mirrors the per-
// conversation hook (useConversation) for fetch / realtime / send / delete.
//
// Side benefit: notifications, digest emails, mentions-only group emails,
// reactions, threads, presence — all handled by the DM infrastructure
// without duplicate paths.
export function useHubChat(moduleId) {
  const { profile } = useAuth()
  const [conversationId, setConversationId] = useState(null)
  const [messages, setMessages] = useState([])
  const [loading, setLoading]   = useState(true)
  const [hasMore, setHasMore]   = useState(true)
  const cidRef = useRef(null)
  cidRef.current = conversationId

  // Resolve the campfire module's conversation id. Trigger
  // create_hub_chat_on_module_insert created the conversation when the
  // module row was inserted; this just reads it back.
  useEffect(() => {
    let cancelled = false
    if (!moduleId) { setConversationId(null); return }
    setConversationId(null)
    setLoading(true)
    setMessages([])
    setHasMore(true)
    supabase.rpc('get_hub_module_conversation', { mod_id: moduleId })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { showToast('Failed to load chat', 'error'); setLoading(false); return }
        setConversationId(data || null)
      })
    return () => { cancelled = true }
  }, [moduleId])

  const fetchPage = useCallback(async (cursor) => {
    if (!cidRef.current) return []
    let q = supabase
      .from('dm_messages')
      .select(MSG_SELECT)
      .eq('conversation_id', cidRef.current)
      // Threads (mig 037) are scoped to per-message side panels; the main
      // Campfire stream shows only roots.
      .is('thread_root_id', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (cursor) q = q.lt('created_at', cursor)
    const { data, error } = await q
    if (error) { showToast('Failed to load chat', 'error'); return [] }
    return (data || []).reverse()
  }, [])

  // Initial page once the conversation id is known.
  useEffect(() => {
    if (!conversationId) return
    let cancelled = false
    fetchPage().then(rows => {
      if (cancelled) return
      setMessages(rows)
      setHasMore(rows.length === PAGE_SIZE)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [conversationId, fetchPage])

  // Realtime: piggyback on the global dmEventBus (one socket, fanned out
  // by useDmRealtime) instead of opening a per-hub channel.
  useEffect(() => {
    if (!conversationId) return
    return onDmMessage(({ conversationId: cid, message }) => {
      if (cid !== conversationId) return
      if (message.thread_root_id) return
      if (message.deleted_at) return
      setMessages(prev => (prev.some(m => m.id === message.id) ? prev : [...prev, message]))
    })
  }, [conversationId])

  const sendMessage = useCallback(async (content, mentions = [], inlineImages = []) => {
    const cid = cidRef.current
    if (!cid || !profile?.id) return false
    const trimmed = (content || '').trim()
    const hasImages = Array.isArray(inlineImages) && inlineImages.length > 0
    if (!trimmed && !hasImages) return false
    const { data, error } = await supabase
      .from('dm_messages')
      .insert({
        conversation_id: cid,
        author_id: profile.id,
        kind: 'user',
        content: trimmed,
        inline_images: inlineImages.map(({ preview, ...rest }) => rest),
        mentions: Array.isArray(mentions) ? mentions : [],
      })
      .select(MSG_SELECT)
      .single()
    if (error || !data) { showToast('Failed to send message', 'error'); return false }
    // Optimistic append; realtime echo is dedup'd by id.
    setMessages(prev => (prev.some(m => m.id === data.id) ? prev : [...prev, data]))
    return true
  }, [profile?.id])

  const deleteMessage = useCallback(async (messageId) => {
    const { error } = await supabase
      .from('dm_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId)
    if (error) { showToast('Failed to delete message', 'error'); return }
    setMessages(prev => prev.filter(m => m.id !== messageId))
  }, [])

  const loadMore = useCallback(async () => {
    if (!hasMore || messages.length === 0) return
    const cursor = messages[0].created_at
    const older = await fetchPage(cursor)
    setMessages(prev => [...older, ...prev])
    setHasMore(older.length === PAGE_SIZE)
  }, [hasMore, messages, fetchPage])

  // Resync on tab-visible — same reasoning as useConversation. Bail out
  // with the existing array reference when no new messages arrived so the
  // Campfire thread doesn't re-render every tab return.
  const resync = useCallback(async () => {
    if (!cidRef.current) return
    const latest = await fetchPage()
    setMessages(prev => {
      if (prev.length === 0) return latest
      const byId = new Map(prev.map(m => [m.id, m]))
      let changed = false
      for (const m of latest) {
        if (!byId.has(m.id)) { byId.set(m.id, m); changed = true }
      }
      if (!changed) return prev
      return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
    })
  }, [fetchPage])
  useDocumentVisible(resync)

  return { messages, loading, sendMessage, deleteMessage, loadMore, hasMore }
}
