import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui'

const MSG_SELECT =
  '*, author:profiles!dm_messages_author_id_fkey(id, full_name, avatar_url), reply_to_author:profiles!dm_messages_reply_to_author_id_fkey(id, full_name)'

// Loads and manages a single thread (root + replies).
//
// Conventions mirror useConversation:
//   · messages are sorted oldest → newest
//   · sendMessage is optimistic; the realtime echo is dedup'd by id
//   · delete is soft via UPDATE deleted_at
//
// Threading rule (Slack-style): one flat level. If the root passed in is
// itself a reply, we collapse to its own thread_root_id so replies to a
// thread reply still land in the same thread.
export function useThread({ conversationId, rootMessage }) {
  const { profile } = useAuth()
  const [root, setRoot] = useState(rootMessage || null)
  const [replies, setReplies] = useState([])
  const [loading, setLoading] = useState(true)

  // Effective root = the message that thread_root_id should point at. For
  // a brand new thread it's the root message itself; for a reply-to-reply
  // we hoist up to the existing thread root.
  const effectiveRootId = root?.thread_root_id || root?.id || null
  const effectiveRootIdRef = useRef(effectiveRootId)
  effectiveRootIdRef.current = effectiveRootId

  useEffect(() => {
    if (!effectiveRootId) { setReplies([]); setLoading(false); return }
    setLoading(true)
    let alive = true

    async function load() {
      // Ensure we have the canonical root in case the caller handed us a
      // reply — we always want to render the thread's actual starting
      // message at the top.
      let canonicalRoot = root
      if (root?.thread_root_id) {
        const { data } = await supabase
          .from('dm_messages')
          .select(MSG_SELECT)
          .eq('id', root.thread_root_id)
          .maybeSingle()
        if (data) canonicalRoot = data
      }
      const { data, error } = await supabase
        .from('dm_messages')
        .select(MSG_SELECT)
        .eq('thread_root_id', effectiveRootId)
        .order('created_at', { ascending: true })
      if (!alive) return
      if (error) {
        showToast('Failed to load thread', 'error')
        setReplies([])
      } else {
        setReplies(data || [])
      }
      setRoot(canonicalRoot)
      setLoading(false)
    }
    load()
    return () => { alive = false }
  }, [effectiveRootId])

  // Realtime scoped to this thread. Covers inserts from other clients and
  // soft-delete updates on both root and replies.
  useEffect(() => {
    if (!effectiveRootId || !conversationId) return
    const channel = supabase
      .channel(`pe-thread-${effectiveRootId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dm_messages' },
        async (payload) => {
          const row = payload.new
          if (!row || row.thread_root_id !== effectiveRootId) return
          const { data } = await supabase
            .from('dm_messages').select(MSG_SELECT).eq('id', row.id).maybeSingle()
          if (!data) return
          setReplies(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data])
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'dm_messages' },
        (payload) => {
          const row = payload.new
          if (!row) return
          if (row.id === effectiveRootId) {
            setRoot(r => r ? { ...r, ...row } : r)
          } else if (row.thread_root_id === effectiveRootId) {
            setReplies(prev => prev.map(m => m.id === row.id ? { ...m, ...row } : m))
          }
        })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [effectiveRootId, conversationId])

  const sendMessage = useCallback(async (content, inlineImages = [], replyTo = null, mentions = [], attachments = []) => {
    const rootId = effectiveRootIdRef.current
    if (!conversationId || !rootId || !profile?.id) return false
    const trimmed = (content || '').trim()
    const hasImages = Array.isArray(inlineImages) && inlineImages.length > 0
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0
    if (!trimmed && !hasImages && !hasAttachments) return false
    const { data, error } = await supabase
      .from('dm_messages')
      .insert({
        conversation_id: conversationId,
        author_id: profile.id,
        kind: 'user',
        content: trimmed,
        inline_images: inlineImages.map(({ preview, ...rest }) => rest),
        attachments: (Array.isArray(attachments) ? attachments : []).map(({ preview, ...rest }) => rest),
        mentions: Array.isArray(mentions) ? mentions : [],
        reply_to_id:        replyTo?.id        || null,
        reply_to_author_id: replyTo?.author_id || null,
        reply_to_preview:   replyTo?.preview   || null,
        thread_root_id:     rootId,
      })
      .select(MSG_SELECT)
      .single()
    if (error || !data) { showToast('Failed to send reply', 'error'); return false }
    setReplies(prev => prev.some(m => m.id === data.id) ? prev : [...prev, data])
    return true
  }, [conversationId, profile?.id])

  const deleteMessage = useCallback(async (messageId) => {
    const { error } = await supabase
      .from('dm_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', messageId)
    if (error) { showToast('Failed to delete message', 'error'); return }
    if (messageId === effectiveRootIdRef.current) {
      setRoot(r => r ? { ...r, deleted_at: new Date().toISOString() } : r)
    } else {
      setReplies(prev => prev.map(m =>
        m.id === messageId ? { ...m, deleted_at: new Date().toISOString() } : m
      ))
    }
  }, [])

  return { root, replies, loading, sendMessage, deleteMessage, effectiveRootId }
}
