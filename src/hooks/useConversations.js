import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui'
import { upsertConversation, sortByLastMessage } from '../lib/conversationOrdering'
import { onMessage, emitRead, onRead } from '../lib/dmEventBus'
import { shapeConversationRow } from '../lib/groupConversations'
import { sortTaskChatRows } from '../lib/taskChat'
import { isExternal } from '../lib/roleHelpers'

// Row shape returned by this hook (per conversation):
//   Common: { id, kind, title, team_id, last_message_at, last_message_preview,
//             last_read_at, muted, unread }
//   DM:     + { other_user_id, other_profile, participants: null }
//   Group:  + { other_user_id: null, other_profile: null, participants: [profile…] }

async function fetchConversationsForUser(userId) {
  const { data: myRows, error: myErr } = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at, muted, conversation:conversations!inner(id, kind, title, team_id, task_id, hub_id, last_message_at, last_message_preview)')
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

  // Parent-task metadata for any kind='task' conversations. Drives the
  // widget's Tasks section (active-only filter + title/urgency display).
  const taskConvs = myRows.filter(r => r.conversation?.kind === 'task')
  const taskIds = [...new Set(taskConvs.map(r => r.conversation.task_id).filter(Boolean))]
  let taskById = new Map()
  if (taskIds.length > 0) {
    const { data: taskRows } = await supabase
      .from('tasks')
      .select('id, title, status, urgency, last_updated')
      .in('id', taskIds)
    taskById = new Map((taskRows || []).map(t => [t.id, t]))
  }

  // Unread counts: one aggregation RPC instead of N parallel HEAD counts
  // (migration 054). For an admin/manager with 100+ conversations this
  // collapses ~100 round trips into one.
  const unreadByConv = new Map()
  const { data: unreadRows, error: unreadErr } = await supabase
    .rpc('get_user_conversation_unreads')
  if (unreadErr) {
    console.warn('get_user_conversation_unreads failed:', unreadErr.message)
  } else if (unreadRows) {
    for (const r of unreadRows) {
      unreadByConv.set(r.conversation_id, Number(r.unread_count) || 0)
    }
  }

  const out = myRows.map(row => shapeConversationRow({
    row,
    participantsByConv,
    profileById,
    unreadByConv,
    taskById,
    myId: userId,
  }))

  return sortByLastMessage(out)
}

export function useConversations() {
  const { profile } = useAuth()
  const instanceId = useId()
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

  // Cross-instance read propagation. markRead (below) only mutates ITS OWN
  // instance's state — but the app mounts MULTIPLE useConversations instances
  // (AuthProvider tab-badge via useTotalUnread, Layout nav badge, ChatWidget,
  // NotificationBell, the /chat sidebar). The increment path (onMessage) already
  // fans out to all of them; without this, the decrement (read) does not, so the
  // browser-tab `(N)`, favicon dot, and Chat-nav badge stay inflated after you
  // read a conversation. The 'read' event (emitted by markRead) lets every
  // instance zero the same conversation's unread.
  //
  // Scoped to MY OWN reads (userId === profile.id): another user reading must
  // never affect my badge. Only the in-memory `unread` integer is reset — we do
  // NOT touch last_read_at, so the amber "New messages" snapshot logic is left
  // intact. When the target conversation is absent or already at 0 unread we
  // return the SAME array reference so React skips re-rendering every consumer;
  // the handler never emits, so there is no feedback loop.
  useEffect(() => {
    if (!profile?.id) return
    return onRead(({ conversationId, userId }) => {
      if (userId !== profile.id) return
      setConversations(prev => {
        const idx = prev.findIndex(c => c.id === conversationId)
        if (idx === -1 || prev[idx].unread === 0) return prev // no-op → same ref, no re-render
        const next = prev.slice()
        next[idx] = { ...next[idx], unread: 0 }
        return next
      })
    })
  }, [profile?.id])

  // Tasks realtime: when a task's status flips into/out of Done, or the
  // task is deleted, the widget's Tasks section needs to re-evaluate
  // (Done tasks are filtered out of the active list). Without this, the
  // row hangs around until the next message arrives or the user reloads.
  //
  // We refetch ONLY on those membership-affecting events. Plain edits
  // (notes/title/urgency/due_date/etc.) used to also refetch — that
  // caused the chat widget to re-render every time someone edited any
  // task in the org, which in turn re-rendered NotificationBell and the
  // contact list. Tightening this is the largest single source of the
  // "page randomly refreshes" complaints.
  //
  // Re-subscribe only when the set of tracked task-conversation ids
  // changes — `taskConvCount` is a cheap-enough proxy since task convs
  // are a small subset and the handler reads from the ref anyway.
  const taskConvCount = useMemo(
    () => conversations.filter(c => c.kind === 'task').length,
    [conversations]
  )
  useEffect(() => {
    if (!profile?.id) return
    if (taskConvCount === 0) return
    // Per-INSTANCE channel name (instanceId). Multiple useConversations can be
    // mounted at once (NotificationBell, ChatWidget, the /chat sidebar, the
    // global unread-tab-badge). A shared channel topic meant one instance's
    // unmount `removeChannel` tore down the others' subscription. A unique
    // suffix per instance isolates them.
    const ch = supabase
      .channel(`tasks-for-conversations-${profile.id}-${instanceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        (payload) => {
          const id = payload.new?.id || payload.old?.id
          if (!id) return
          const tracked = convsRef.current.some(
            c => c.kind === 'task' && c.task_id === id
          )
          if (!tracked) return

          if (payload.eventType === 'DELETE') { refetch(); return }
          if (payload.eventType === 'INSERT') return // not relevant to existing list

          // UPDATE: only meaningful if status crosses the Done boundary.
          const wasDone = payload.old?.status === 'Done'
          const isDone  = payload.new?.status === 'Done'
          if (wasDone !== isDone) refetch()
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [profile?.id, taskConvCount, refetch, instanceId])

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
    const readAt = new Date().toISOString()
    setConversations(prev => prev.map(c =>
      c.id === conversationId
        ? { ...c, last_read_at: readAt, unread: 0 }
        : c
    ))
    // Fan the decrement out to every OTHER useConversations instance so the
    // tab badge / favicon dot / nav badge clear in lockstep (the onRead effect
    // above zeroes each instance's unread). Scoped to my own id on the receiver.
    emitRead(conversationId, profile?.id, readAt)
  }, [profile?.id])

  // Externals (Agent/Client) only ever see their team group conversations,
  // task chats they're part of, and hub conversations they're members of —
  // no DMs, no custom groups. This is defense-in-depth: the widget itself
  // is already gated on !isExternal in App.jsx, but this filter ensures
  // any future caller of the hook honors the same rule. Task chats match
  // migration 046 RLS; hub chats match migration 064 RLS (externals are
  // participants iff they're hub_members).
  const visibleConversations = useMemo(() => {
    if (!isExternal(profile)) return conversations
    return conversations.filter(c =>
      (c.kind === 'group' && c.team_id) || c.kind === 'task' || c.kind === 'hub'
    )
  }, [conversations, profile])

  // Active task chats sorted by most-recent activity. Filters out tasks
  // whose parent is Done. Uses the pure sorter from src/lib/taskChat.js.
  const tasks = useMemo(() => {
    const active = visibleConversations.filter(
      c => c.kind === 'task' && c.task_status !== 'Done'
    )
    return sortTaskChatRows(active)
  }, [visibleConversations])

  return {
    conversations: visibleConversations,
    tasks,
    loading,
    refetch,
    createOrOpen,
    createGroup,
    markRead,
  }
}
