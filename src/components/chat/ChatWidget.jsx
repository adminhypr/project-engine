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

export default function ChatWidget() {
  const { profile } = useAuth()
  const [state, setState] = useState(() => readWidgetState(profile?.id))
  const [query, setQuery] = useState('')
  const [assignForConversation, setAssignForConversation] = useState(null)

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

  const { sections, conversations, presence, createOrOpen, markRead } = useContactList(query)
  const total = sumUnread(conversations)

  const openOne = useCallback(async (otherUserId) => {
    const convId = await createOrOpen(otherUserId)
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
  }, [createOrOpen])

  const closeOne = useCallback((convId) => {
    setState(s => ({
      ...s,
      openConversationIds: s.openConversationIds.filter(id => id !== convId),
      minimizedIds:        s.minimizedIds.filter(id => id !== convId),
    }))
  }, [])

  const minimizeOne = useCallback((convId) => {
    setState(s => ({
      ...s,
      minimizedIds: s.minimizedIds.includes(convId) ? s.minimizedIds : [...s.minimizedIds, convId],
    }))
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
          onClose={closeOne}
          onMinimize={minimizeOne}
          onRestore={restoreOne}
          onMarkRead={markRead}
          onAssignTask={conv => setAssignForConversation(conv)}
        />
        {state.expanded && (
          <ChatPanel onClose={() => setState(s => ({ ...s, expanded: false }))}>
            <div className="p-3">
              <ContactSearch value={query} onChange={setQuery} />
            </div>
            <ContactList
              sections={sections}
              presence={presence}
              onOpen={openOne}
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
    </>
  )
}
