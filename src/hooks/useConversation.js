import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui'
import { onMessage } from '../lib/dmEventBus'
import { useDocumentVisible } from '../lib/useDocumentVisible'

const PAGE_SIZE = 50

const MSG_SELECT =
  '*, author:profiles!dm_messages_author_id_fkey(id, full_name, avatar_url), reply_to_author:profiles!dm_messages_reply_to_author_id_fkey(id, full_name)'

export function useConversation(conversationId) {
  const { profile } = useAuth()
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const cidRef = useRef(conversationId)
  cidRef.current = conversationId

  const fetchPage = useCallback(async (cursor) => {
    if (!cidRef.current) return []
    let q = supabase
      .from('dm_messages')
      .select(MSG_SELECT)
      .eq('conversation_id', cidRef.current)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (cursor) q = q.lt('created_at', cursor)
    const { data, error } = await q
    if (error) { showToast('Failed to load messages', 'error'); return [] }
    return (data || []).reverse()
  }, [])

  useEffect(() => {
    if (!conversationId) { setMessages([]); setLoading(false); return }
    setLoading(true)
    setMessages([])
    setHasMore(true)
    fetchPage().then(rows => {
      setMessages(rows)
      setHasMore(rows.length === PAGE_SIZE)
      setLoading(false)
    })
  }, [conversationId, fetchPage])

  useEffect(() => {
    if (!conversationId) return
    return onMessage(({ conversationId: cid, message }) => {
      if (cid !== conversationId) return
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev
        return [...prev, message]
      })
    })
  }, [conversationId])

  const sendMessage = useCallback(async (content, inlineImages = [], replyTo = null) => {
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
        reply_to_id:        replyTo?.id        || null,
        reply_to_author_id: replyTo?.author_id || null,
        reply_to_preview:   replyTo?.preview   || null,
      })
      .select(MSG_SELECT)
      .single()
    if (error || !data) { showToast('Failed to send message', 'error'); return false }
    // Optimistic append — realtime echo is dedup'd by id below.
    setMessages(prev => (prev.some(m => m.id === data.id) ? prev : [...prev, data]))
    return true
  }, [profile?.id])

  const sendSystemMessage = useCallback(async (content) => {
    const cid = cidRef.current
    if (!cid || !profile?.id) return false
    const { error } = await supabase.from('dm_messages').insert({
      conversation_id: cid,
      author_id: profile.id,
      kind: 'system',
      content,
    })
    if (error) { showToast('Failed to post system message', 'error'); return false }
    return true
  }, [profile?.id])

  const deleteMessage = useCallback(async (messageId) => {
    const { error } = await supabase
      .from('dm_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId)
    if (error) { showToast('Failed to delete message', 'error'); return }
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, deleted_at: new Date().toISOString() } : m
    ))
  }, [])

  const loadMore = useCallback(async () => {
    if (!hasMore || messages.length === 0) return
    const cursor = messages[0].created_at
    const older = await fetchPage(cursor)
    setMessages(prev => [...older, ...prev])
    setHasMore(older.length === PAGE_SIZE)
  }, [hasMore, messages, fetchPage])

  // If the realtime socket was asleep while the tab was hidden, messages may
  // have been missed. On tab-visible, pull anything newer than what we have.
  const resync = useCallback(async () => {
    if (!cidRef.current) return
    const latest = await fetchPage()
    setMessages(prev => {
      if (prev.length === 0) return latest
      const byId = new Map(prev.map(m => [m.id, m]))
      for (const m of latest) if (!byId.has(m.id)) byId.set(m.id, m)
      return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
    })
  }, [fetchPage])
  useDocumentVisible(resync)

  return { messages, loading, hasMore, sendMessage, sendSystemMessage, deleteMessage, loadMore }
}
