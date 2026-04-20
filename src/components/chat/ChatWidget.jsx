import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useContactList } from '../../hooks/useContactList'
import { totalUnread as sumUnread } from '../../lib/dmUnread'
import { readWidgetState, writeWidgetState } from '../../lib/dmWidgetStorage'
import { supabase } from '../../lib/supabase'
import ChatLauncher from './ChatLauncher'
import ChatPanel from './ChatPanel'
import ContactSearch from './ContactSearch'
import ContactList from './ContactList'
import ConversationStack from './ConversationStack'
import AssignFromChatModal from './AssignFromChatModal'
import CreateGroupModal from './CreateGroupModal'

export default function ChatWidget() {
  const { profile } = useAuth()
  const [state, setState] = useState(() => readWidgetState(profile?.id))
  const [query, setQuery] = useState('')
  const [assignForConversation, setAssignForConversation] = useState(null)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  // Maximize state is deliberately in-memory only — resets on reload.
  const [maximizedId, setMaximizedId] = useState(null)

  useEffect(() => { setState(readWidgetState(profile?.id)) }, [profile?.id])
  useEffect(() => { writeWidgetState(profile?.id, state) }, [profile?.id, state])

  useEffect(() => {
    function handler(e) {
      const convId = e.detail?.conversationId
      if (!convId) return
      setState(s => ({
        ...s,
        expanded: true,
        openConversationIds: s.openConversationIds.includes(convId)
          ? s.openConversationIds
          : [...s.openConversationIds, convId],
        minimizedIds: s.minimizedIds.filter(id => id !== convId),
      }))
    }
    window.addEventListener('pe-chat-open', handler)
    return () => window.removeEventListener('pe-chat-open', handler)
  }, [])

  const { sections, groups, conversations, presence, createOrOpen, createGroup, markRead } =
    useContactList(query)
  const total = sumUnread(conversations)

  // Add a conversation id to the open list. Shared by DM-open, group-open,
  // and post-create flows so they all behave identically.
  const openConversationById = useCallback((convId) => {
    if (!convId) return
    setState(s => {
      const openIds = s.openConversationIds.includes(convId)
        ? s.openConversationIds
        : [...s.openConversationIds, convId]
      return {
        ...s,
        expanded: true,
        openConversationIds: openIds,
        minimizedIds: s.minimizedIds.filter(id => id !== convId),
      }
    })
  }, [])

  const openOne = useCallback(async (otherUserId) => {
    const convId = await createOrOpen(otherUserId)
    if (!convId) return
    openConversationById(convId)
  }, [createOrOpen, openConversationById])

  const closeOne = useCallback((convId) => {
    setMaximizedId(m => (m === convId ? null : m))
    setState(s => ({
      ...s,
      openConversationIds: s.openConversationIds.filter(id => id !== convId),
      minimizedIds:        s.minimizedIds.filter(id => id !== convId),
    }))
  }, [])

  const minimizeOne = useCallback((convId) => {
    setMaximizedId(m => (m === convId ? null : m))
    setState(s => ({
      ...s,
      minimizedIds: s.minimizedIds.includes(convId) ? s.minimizedIds : [...s.minimizedIds, convId],
    }))
  }, [])

  const toggleMaximize = useCallback((convId) => {
    setMaximizedId(m => (m === convId ? null : convId))
  }, [])

  const restoreOne = useCallback((convId) => {
    setState(s => ({
      ...s,
      minimizedIds: s.minimizedIds.filter(id => id !== convId),
      openConversationIds: s.openConversationIds.includes(convId)
        ? s.openConversationIds
        : [...s.openConversationIds, convId],
    }))
  }, [])

  const reorderOpen = useCallback((fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return
    setState(s => {
      const from = s.openConversationIds.indexOf(fromId)
      const to   = s.openConversationIds.indexOf(toId)
      if (from < 0 || to < 0) return s
      const next = s.openConversationIds.slice()
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...s, openConversationIds: next }
    })
  }, [])

  const handleSystemMessagePost = useCallback(async (sysText) => {
    if (!assignForConversation || !profile?.id) return
    await supabase.from('dm_messages').insert({
      conversation_id: assignForConversation.id,
      author_id: profile.id,
      kind: 'system',
      content: sysText,
    })
  }, [assignForConversation, profile?.id])

  if (!profile?.id) return null

  return (
    <>
      <div className="fixed bottom-4 right-4 z-40 flex items-end gap-3">
        <ConversationStack
          openConversationIds={state.openConversationIds}
          minimizedIds={state.minimizedIds}
          conversations={conversations}
          presence={presence}
          maximizedId={maximizedId}
          onClose={closeOne}
          onMinimize={minimizeOne}
          onRestore={restoreOne}
          onMarkRead={markRead}
          onAssignTask={conv => setAssignForConversation(conv)}
          onReorder={reorderOpen}
          onToggleMaximize={toggleMaximize}
        />
        {state.expanded && (
          <ChatPanel onClose={() => setState(s => ({ ...s, expanded: false }))}>
            <div className="p-3">
              <ContactSearch value={query} onChange={setQuery} />
            </div>
            <ContactList
              sections={sections}
              groups={groups}
              presence={presence}
              onOpen={openOne}
              onOpenGroup={openConversationById}
              onCreateGroup={() => setCreateGroupOpen(true)}
            />
          </ChatPanel>
        )}
        <ChatLauncher
          totalUnread={total}
          onClick={() => setState(s => ({ ...s, expanded: !s.expanded }))}
        />
      </div>
      {assignForConversation && (
        <AssignFromChatModal
          conversation={assignForConversation}
          onClose={() => setAssignForConversation(null)}
          onPosted={handleSystemMessagePost}
        />
      )}
      <CreateGroupModal
        isOpen={createGroupOpen}
        onClose={() => setCreateGroupOpen(false)}
        createGroup={createGroup}
        onCreated={(convId) => {
          setCreateGroupOpen(false)
          openConversationById(convId)
        }}
      />
    </>
  )
}
