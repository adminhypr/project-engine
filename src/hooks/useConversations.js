import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui'
import { upsertConversation, sortByLastMessage } from '../lib/conversationOrdering'
import { onMessage } from '../lib/dmEventBus'
import { shapeConversationRow } from '../lib/groupConversations'
import { isExternal } from '../lib/roleHelpers'

// Row shape returned by this hook (per conversation):
//   Common: { id, kind, title, team_id, last_message_at, last_message_preview,
//             last_read_at, muted, unread }
//   DM:     + { other_user_id, other_profile, participants: null }
//   Group:  + { other_user_id: null, other_profile: null, participants: [profile…] }

async function fetchConversationsForUser(userId) {
  const { data: myRows, error: myErr } = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at, muted, conversation:conversations!inner(id, kind, title, team_id, last_message_at, last_message_preview)')
    .eq('user_id', userId)
  if (myErr) throw myErr
  if (!myRows || myRows.length === 0) return []

  const convIds = myRows.map(r => r.conversation_id)

  // All participants (including myself) for every conversation. For DMs this
  // lets us derive the single "other" user; for groups we expose the full
  // participant list.
  const { data: allParts, error: partsErr } = await supabase
    .from('conversation_participants')
    .select('conversation_id, user_id')
    .in('conversation_id', convIds)
  if (partsErr) throw partsErr

  const participantsByConv = new Map()
  for (const p of allParts || []) {
    const arr = participantsByConv.get(p.conversation_id) || []
    arr.push(p.user_id)
    participantsByConv.set(p.conversation_id, arr)
  }

  const allUserIds = [...new Set((allParts || []).map(p => p.user_id))]
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, email, team_id')
    .in('id', allUserIds)
  const profileById = new Map((profiles || []).map(p => [p.id, p]))

  // Unread counts: messages created after my last_read_at, by someone else.
  const unreadByConv = new Map()
  await Promise.all(myRows.map(async (row) => {
    const { count } = await supabase
      .from('dm_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', row.conversation_id)
      .neq('author_id', userId)
      .gt('created_at', row.last_read_at)
    unreadByConv.set(row.conversation_id, count || 0)
  }))

  const out = myRows.map(row => shapeConversationRow({
    row,
    participantsByConv,
    profileById,
    unreadByConv,
    myId: userId,
  }))

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

  const createGroup = useCallback(async (title, memberIds) => {
    if (!profile?.id) return null
    const { data, error } = await supabase.rpc('create_custom_group', {
      title: (title || '').trim(),
      member_ids: memberIds || [],
    })
    if (error) { showToast('Failed to create group', 'error'); return null }
    await refetch()
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

  // Externals (Agent/Client) only ever see their team group conversations
  // in the chat widget — no DMs, no custom groups. This is defense-in-depth:
  // the widget itself is already gated on !isExternal in App.jsx, but this
  // filter ensures any future caller of the hook honors the same rule.
  const visibleConversations = useMemo(() => {
    if (!isExternal(profile)) return conversations
    return conversations.filter(c => c.kind === 'group' && c.team_id)
  }, [conversations, profile])

  return {
    conversations: visibleConversations,
    loading,
    refetch,
    createOrOpen,
    createGroup,
    markRead,
  }
}
