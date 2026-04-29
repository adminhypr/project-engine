import { useEffect, useState, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { isExternal } from '../../lib/roleHelpers'
import { useContactList } from '../../hooks/useContactList'
import { totalUnread as sumUnread } from '../../lib/dmUnread'
import { readWidgetState, writeWidgetState } from '../../lib/dmWidgetStorage'
import { setMutedConvIds, setMaximizedConvId } from '../../lib/dmSoundContext'
import { supabase } from '../../lib/supabase'
import ChatLauncher from './ChatLauncher'
import ChatPanel from './ChatPanel'
import ContactSearch from './ContactSearch'
import ContactList from './ContactList'
import ConversationStack from './ConversationStack'
import AssignFromChatModal from './AssignFromChatModal'
import CreateGroupModal from './CreateGroupModal'
import ExpandedChatModal from './ExpandedChatModal'

export default function ChatWidget() {
  const { profile } = useAuth()
  const [state, setState] = useState(() => readWidgetState(profile?.id))
  const [query, setQuery] = useState('')
  const [assignForConversation, setAssignForConversation] = useState(null)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)
  // Maximize state is deliberately in-memory only — resets on reload.
  const [maximizedId, setMaximizedId] = useState(null)
  // Full-screen "focus mode" toggle — also in-memory only. The user opens
  // it intentionally for a reading session; persisting across reload would
  // confuse anyone landing on the page mid-task.
  const [fullExpanded, setFullExpanded] = useState(false)
  // Single global thread state — only one thread can be open across the
  // whole widget. Keyed { convId, rootMessage }. Lifted up here so the
  // ConversationStack can focus this pane (same as maximize) and the
  // adjacent panes that wouldn't fit collapse to avatar tabs.
  const [threadState, setThreadState] = useState(null)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => { setState(readWidgetState(profile?.id)) }, [profile?.id])
  useEffect(() => { writeWidgetState(profile?.id, state) }, [profile?.id, state])

  // Consume URL deep-link params (?dm=<convId>&message=<msgId>) on mount
  // AND on URL change. Open the conversation; if a message id is provided
  // fire a `pe-chat-scroll-to-message` follow-up event so the open pane
  // scrolls + highlights it (existing pattern uses `data-message-id` +
  // `pe-msg-highlight`). Then strip the params so back/forward doesn't
  // re-trigger and so the URL stays clean.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const convId = params.get('dm')
    if (!convId) return

    const messageId = params.get('message')
    setThreadState(null)
    setState(s => ({
      ...s,
      expanded: true,
      openConversationIds: s.openConversationIds.includes(convId)
        ? s.openConversationIds
        : [...s.openConversationIds, convId],
      minimizedIds: s.minimizedIds.filter(id => id !== convId),
    }))
    if (messageId) {
      // Defer so the pane has rendered before we ask it to scroll.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('pe-chat-scroll-to-message', {
          detail: { conversationId: convId, messageId },
        }))
      }, 200)
    }
    // Strip the params so the URL is clean after the deep-link is consumed.
    const next = new URLSearchParams(location.search)
    next.delete('dm')
    next.delete('message')
    const qs = next.toString()
    navigate(
      { pathname: location.pathname, search: qs ? `?${qs}` : '' },
      { replace: true }
    )
  }, [location.search, location.pathname, navigate])

  // Existing pe-chat-open listener — extended to forward messageId via the
  // new pe-chat-scroll-to-message event when present.
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
      const messageId = e.detail?.messageId
      if (messageId) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('pe-chat-scroll-to-message', {
            detail: { conversationId: convId, messageId },
          }))
        }, 200)
      }
    }
    window.addEventListener('pe-chat-open', handler)
    return () => window.removeEventListener('pe-chat-open', handler)
  }, [])

  const { sections, groups, campfires, tasks, conversations, presence, createOrOpen, createGroup, markRead } =
    useContactList(query)
  const total = sumUnread(conversations)

  // Keep the global DM sound-suppression context in sync so useDmRealtime
  // can skip the ping for muted conversations and the one the user is
  // actively reading.
  useEffect(() => {
    setMutedConvIds(conversations.filter(c => c.muted).map(c => c.id))
  }, [conversations])
  useEffect(() => {
    setMaximizedConvId(maximizedId)
  }, [maximizedId])

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
    if (!convId) return null
    openConversationById(convId)
    return convId
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

  // Pick the conversation the modal should open with — preference order:
  //   maximized → most-recent open non-minimized → null. Computed lazily so
  //   the modal opens on whatever the user was last looking at.
  const pickInitialModalConvId = () => {
    if (maximizedId) return maximizedId
    const open = state.openConversationIds.filter(id => !state.minimizedIds.includes(id))
    return open[open.length - 1] || null
  }

  return (
    <>
      {/* Bottom-right widget — hidden while in full-expanded focus mode so we
          don't render the same conversation in two places. */}
      {!fullExpanded && (
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
            <ChatPanel
              onClose={() => setState(s => ({ ...s, expanded: false }))}
              onExpand={() => setFullExpanded(true)}
            >
              <div className="p-3">
                <ContactSearch value={query} onChange={setQuery} />
              </div>
              <ContactList
                sections={sections}
                groups={groups}
                campfires={campfires}
                tasks={tasks}
                presence={presence}
                onOpen={openOne}
                onOpenGroup={openConversationById}
                onOpenCampfire={openConversationById}
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
      )}

      {fullExpanded && (
        <ExpandedChatModal
          sections={sections}
          groups={groups}
          campfires={campfires}
          tasks={tasks}
          conversations={conversations}
          presence={presence}
          query={query}
          onQueryChange={setQuery}
          createOrOpenDm={createOrOpen}
          onMarkRead={markRead}
          onAssignTask={conv => setAssignForConversation(conv)}
          onCreateGroup={() => setCreateGroupOpen(true)}
          initialActiveConvId={pickInitialModalConvId()}
          threadState={threadState}
          onOpenThread={openThread}
          onCloseThread={closeThread}
          onClose={() => setFullExpanded(false)}
        />
      )}

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
