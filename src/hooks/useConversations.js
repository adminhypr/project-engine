import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui'
import { upsertConversation, sortByLastMessage } from '../lib/conversationOrdering'
import { onMessage } from '../lib/dmEventBus'

// Row shape returned by this hook:
//   { id, kind, last_message_at, last_message_preview,
//     last_read_at, other_user_id, other_profile, unread }

async function fetchConversationsForUser(userId) {
  const { data: myRows, error: myErr } = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at, muted, conversation:conversations!inner(id, kind, last_message_at, last_message_preview)')
    .eq('user_id', userId)
  if (myErr) throw myErr
  if (!myRows || myRows.length === 0) return []

  const convIds = myRows.map(r => r.conversation_id)

  const { data: allParts, error: partsErr } = await supabase
    .from('conversation_participants')
    .select('conversation_id, user_id')
    .in('conversation_id', convIds)
    .neq('user_id', userId)
  if (partsErr) throw partsErr

  const otherIds = [...new Set(allParts.map(p => p.user_id))]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, email, team_id')
    .in('id', otherIds)
  const profileById = new Map((profiles || []).map(p => [p.id, p]))

  const unreadCounts = new Map()
  await Promise.all(myRows.map(async (row) => {
    const { count } = await supabase
      .from('dm_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', row.conversation_id)
      .neq('author_id', userId)
      .gt('created_at', row.last_read_at)
    unreadCounts.set(row.conversation_id, count || 0)
  }))

  const out = myRows.map(row => {
    const otherId = allParts.find(p => p.conversation_id === row.conversation_id)?.user_id
    const otherProfile = otherId ? profileById.get(otherId) : null
    return {
      id: row.conversation_id,
      kind: row.conversation.kind,
      last_message_at: row.conversation.last_message_at,
      last_message_preview: row.conversation.last_message_preview,
      last_read_at: row.last_read_at,
      muted: row.muted,
      other_user_id: otherId,
      other_profile: otherProfile,
      unread: unreadCounts.get(row.conversation_id) || 0,
    }
  })

  return sortByLastMessage(out)
}

export function useConversations() {
  const { profile } = useAuth()
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const convsRef = useRef([])
  convsRef.current = conversations

  const refetch = useCallback(async () => {
    if (!profile?.id) return
    try {
      const data = await fetchConversationsForUser(profile.id)
      setConversations(data)
    } catch (e) {
      showToast('Failed to load conversations', 'error')
    } finally {
      setLoading(false)
    }
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) { setConversations([]); setLoading(false); return }
    setLoading(true)
    refetch()
  }, [profile?.id, refetch])

  useEffect(() => {
    if (!profile?.id) return
    return onMessage(({ conversationId, message }) => {
      const existing = convsRef.current.find(c => c.id === conversationId)
      if (!existing) {
        refetch()
        return
      }
      const updated = {
        ...existing,
        last_message_at: message.created_at,
        last_message_preview: (message.content || '').slice(0, 140),
        unread: message.author_id === profile.id
          ? existing.unread
          : (existing.unread + 1),
      }
      setConversations(prev => upsertConversation(prev, updated))
    })
  }, [profile?.id, refetch])

  const createOrOpen = useCallback(async (otherUserId) => {
    if (!profile?.id || !otherUserId) return null
    const { data, error } = await supabase.rpc('get_or_create_dm', { other_user_id: otherUserId })
    if (error) { showToast('Failed to open conversation', 'error'); return null }
    if (!convsRef.current.find(c => c.id === data)) {
      await refetch()
    }
    return data
  }, [profile?.id, refetch])

  const markRead = useCallback(async (conversationId) => {
    const { error } = await supabase.rpc('mark_conversation_read', { cid: conversationId })
    if (error) return
    setConversations(prev => prev.map(c =>
      c.id === conversationId
        ? { ...c, last_read_at: new Date().toISOString(), unread: 0 }
        : c
    ))
  }, [])

  return { conversations, loading, refetch, createOrOpen, markRead }
}
