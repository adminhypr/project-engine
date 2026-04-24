import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { isExternal } from '../../lib/roleHelpers'
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
  // Single global thread state — only one thread can be open across the
  // whole widget. Keyed { convId, rootMessage }. Lifted up here so the
  // ConversationStack can focus this pane (same as maximize) and the
  // adjacent panes that wouldn't fit collapse to avatar tabs.
  const [threadState, setThreadState] = useState(null)

  useEffect(() => { setState(readWidgetState(profile?.id)) }, [profile?.id])
  useEffect(() => { writeWidgetState(profile?.id, state) }, [profile?.id, state])

  useEffect(() => {
    function handler(e) {
      const convId = e.detail?.conversationId
      if (!convId) return
      setThreadState(null)
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

  const { sections, groups, tasks, conversations, presence, createOrOpen, createGroup, markRead } =
    useContactList(query)
  const total = sumUnread(conversations)

  // Add a conversation id to the open list. Shared by DM-open, group-open,
  // and post-create flows so they all behave identically.
  //
  // Opening any new chat closes any open thread: the user's explicit
  // "show me this other chat" intent outweighs staying in a thread. If the
  // new chat IS the thread's host conversation, closing the thread also
  // makes room for it to render at normal width. The thread itself is
  // easy to reopen via the "N replies" footer on its root message.
  const openConversationById = useCallback((convId) => {
    if (!convId) return
    setThreadState(null)
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
    setThreadState(t => (t?.convId === convId ? null : t))
    setState(s => ({
      ...s,
      openConversationIds: s.openConversationIds.filter(id => id !== convId),
      minimizedIds:        s.minimizedIds.filter(id => id !== convId),
    }))
  }, [])

  const minimizeOne = useCallback((convId) => {
    setMaximizedId(m => (m === convId ? null : m))
    setThreadState(t => (t?.convId === convId ? null : t))
    setState(s => ({
      ...s,
      minimizedIds: s.minimizedIds.includes(convId) ? s.minimizedIds : [...s.minimizedIds, convId],
    }))
  }, [])

  const toggleMaximize = useCallback((convId) => {
    setMaximizedId(m => (m === convId ? null : convId))
  }, [])

  const openThread = useCallback((convId, rootMessage) => {
    if (!convId || !rootMessage) return
    setThreadState({ convId, rootMessage })
  }, [])

  const closeThread = useCallback(() => setThreadState(null), [])

  const restoreOne = useCallback((convId) => {
    // Clicking an overflow/minimized avatar is the user asking to see
    // that pane — same signal as opening a new chat, so close any open
    // thread to make the expected layout fit.
    setThreadState(t => (t?.convId === convId ? t : null))
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
  // Defense in depth: App.jsx already guards the mount, but if the widget is
  // ever re-mounted for an external user, render nothing so no launcher,
  // contact list, or persisted-expanded panel ever appears.
  if (isExternal(profile)) return null

  return (
    <>
      <div className="fixed bottom-4 right-4 z-40 flex items-end gap-3">
        <ConversationStack
          openConversationIds={state.openConversationIds}
          minimizedIds={state.minimizedIds}
          conversations={conversations}
          presence={presence}
          maximizedId={maximizedId}
          threadState={threadState}
          onClose={closeOne}
          onMinimize={minimizeOne}
          onRestore={restoreOne}
          onMarkRead={markRead}
          onAssignTask={conv => setAssignForConversation(conv)}
          onReorder={reorderOpen}
          onToggleMaximize={toggleMaximize}
          onOpenThread={openThread}
          onCloseThread={closeThread}
        />
        {state.expanded && (
          <ChatPanel onClose={() => setState(s => ({ ...s, expanded: false }))}>
            <div className="p-3">
              <ContactSearch value={query} onChange={setQuery} />
            </div>
            <ContactList
              sections={sections}
              groups={groups}
              tasks={tasks}
              presence={presence}
              onOpen={openOne}
              onOpenGroup={openConversationById}
              onOpenTask={openConversationById}
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
