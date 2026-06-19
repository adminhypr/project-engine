import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { showToast } from '../ui'
import { useAuth } from '../../hooks/useAuth'
import { useConversation } from '../../hooks/useConversation'
import { useDmTyping } from '../../hooks/useDmTyping'
import { useOtherReadState } from '../../hooks/useOtherReadState'
import { useGroupReadState } from '../../hooks/useGroupReadState'
import ConversationHeader from './ConversationHeader'
import ChatComposer from './ChatComposer'
import TypingIndicator from './TypingIndicator'
import GroupMembersModal from './GroupMembersModal'
import AssignTodoFromChatModal from './AssignTodoFromChatModal'
import ThreadPanel from './ThreadPanel'
import { ReplyProvider, useReplyContext } from './ReplyContext'
import SlackMessageList from './slack/SlackMessageList'

export default function ConversationPane({
  conversation,
  online,
  onClose,
  onMinimize,
  onMarkRead,
  onAssignTask,
  dragHandleProps,
  isMaximized,
  onToggleMaximize,
  onGroupChanged,
  threadRoot,
  onOpenThread,
  onCloseThread,
  fullPage = false,
}) {
  const { profile, isExternal } = useAuth()
  const { messages, loading, hasMore, sendMessage, deleteMessage, loadMore } =
    useConversation(conversation.id)
  const isGroup = conversation.kind === 'group' || conversation.kind === 'hub'
  // Typing + read receipts are DM-only for this pass. In groups they'd need
  // multi-user reasoning; we disable them cleanly via null IDs so the hooks
  // short-circuit on the first line of their effects.
  // Typing works in both DMs and groups now. useDmTyping tracks per-user
  // typing state internally; we resolve the ids to names below.
  const { typingUserIds, otherTyping, emitTyping } = useDmTyping(
    conversation.id,
    profile?.id,
  )
  const otherLastReadAt = useOtherReadState(
    isGroup ? null : conversation.id,
    isGroup ? null : conversation.other_user_id,
  )
  const groupReaders = useGroupReadState(
    isGroup ? conversation.id : null,
    isGroup ? conversation.participants : null,
  )

  const [membersOpen, setMembersOpen] = useState(false)
  const [todoOpen, setTodoOpen] = useState(false)
  const [callStarting, setCallStarting] = useState(false)
  // Video calls ship behind a flag so the button stays hidden in prod until
  // the Google Meet setup is done + secrets are set (see the design doc).
  const callsEnabled = import.meta.env.VITE_CALLS_ENABLED === 'true'

  // Start a Google Meet call for this conversation: the edge function mints
  // the space, posts the call card (realtime fans it to everyone), and we
  // open the link for the starter. Button is disabled while in flight.
  const startCall = useCallback(async () => {
    if (callStarting) return
    setCallStarting(true)
    try {
      const { data, error } = await supabase.functions.invoke('create-meet-link', {
        body: { conversation_id: conversation.id },
      })
      if (error) { showToast('Could not start the call', 'error'); return }
      if (data?.error === 'not_configured') { showToast('Video calls aren’t set up yet', 'error'); return }
      if (data?.url) { window.open(data.url, '_blank', 'noopener,noreferrer'); return }
      showToast('Could not start the call', 'error')
    } catch {
      showToast('Could not start the call', 'error')
    } finally {
      setCallStarting(false)
    }
  }, [callStarting, conversation.id])
  // Thread state is lifted to ChatWidget so only one thread can be open
  // across the whole widget, and the stack can focus that pane (same
  // idea as maximize) to avoid overflowing the right-anchored row.
  const openThread = useCallback((message) => {
    if (!message || !onOpenThread) return
    onOpenThread(message)
  }, [onOpenThread])
  const closeThread = onCloseThread || (() => {})

  useEffect(() => {
    onMarkRead?.(conversation.id)
  }, [conversation.id, messages.length, onMarkRead])

  // Jump-to-message: used by quoted replies. Try DOM first (fast path).
  // If the target isn't in the currently rendered window, keep paging back
  // until it shows up or we exhaust history. The scrollRoot ref scopes the
  // smooth scroll to THIS pane's message list.
  const scrollRootRef = useRef(null)
  const hasMoreRef = useRef(hasMore)
  hasMoreRef.current = hasMore
  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore

  const scrollToMessage = useCallback((id) => {
    if (!id) return
    const root = scrollRootRef.current
    if (!root) return
    let attempts = 0
    function tick() {
      const el = root.querySelector(`[data-message-id="${CSS.escape(id)}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.remove('pe-msg-highlight')
        // Re-trigger animation on next frame.
        requestAnimationFrame(() => el.classList.add('pe-msg-highlight'))
        setTimeout(() => el.classList.remove('pe-msg-highlight'), 1600)
        return
      }
      if (!hasMoreRef.current || attempts >= 8) return
      attempts++
      Promise.resolve(loadMoreRef.current?.()).then(() => {
        setTimeout(tick, 60)
      })
    }
    tick()
  }, [])

  // Bridge from the global URL deep-link path: ChatWidget dispatches
  // `pe-chat-scroll-to-message` after opening the conversation. Each pane
  // listens and reuses its existing scrollToMessage machinery (history
  // paging + highlight). Filtered to this pane's conversation id so other
  // open panes don't all jump.
  useEffect(() => {
    function handler(e) {
      if (e.detail?.conversationId !== conversation.id) return
      const messageId = e.detail?.messageId
      if (!messageId) return
      scrollToMessage(messageId)
    }
    window.addEventListener('pe-chat-scroll-to-message', handler)
    return () => window.removeEventListener('pe-chat-scroll-to-message', handler)
  }, [conversation.id, scrollToMessage])

  // Profile lookup covers everyone who could appear as a reactor, mentioner,
  // or typer — group participants, the DM other party, and me. Consumed by
  // MessageReactions to show "Alice, Bob, You" on pill hover.
  const profileLookup = useMemo(() => {
    const map = new Map()
    if (isGroup) {
      for (const p of conversation.participants || []) {
        if (p?.id) map.set(p.id, p)
      }
    } else if (conversation.other_profile?.id) {
      map.set(conversation.other_profile.id, conversation.other_profile)
    }
    if (profile?.id) map.set(profile.id, profile)
    return map
  }, [isGroup, conversation.participants, conversation.other_profile, profile])

  // Resolve typing user ids → display names. In a DM, the single "other"
  // profile is the only candidate. In a group, we look each id up in the
  // participants list.
  let typingNames = []
  if (typingUserIds.length > 0) {
    if (isGroup) {
      const byId = new Map((conversation.participants || []).map(p => [p.id, p]))
      typingNames = typingUserIds
        .map(id => byId.get(id)?.full_name)
        .filter(Boolean)
    } else {
      typingNames = [
        conversation.other_profile?.full_name
          || conversation.other_profile?.email
          || 'Contact',
      ]
    }
  }

  const mentionablePeople = isGroup
    ? (conversation.participants || [])
        .filter(p => p.id && p.id !== profile?.id)
        .map(p => ({ id: p.id, full_name: p.full_name, avatar_url: p.avatar_url }))
    : []

  return (
    <ReplyProvider scrollToMessage={scrollToMessage}>
      {/*
        Single card that grows horizontally when a thread is open — matches
        Slack's split layout. Main conversation on the LEFT, thread on the
        RIGHT, one outer shell (border + shadow + rounded corners).
      */}
      <div className={`${
        fullPage
          ? 'w-full h-full rounded-none border-0 shadow-none'
          : `${
              isMaximized
                ? (threadRoot
                    ? 'w-[min(1100px,96vw)] h-[min(720px,82vh)]'
                    : 'w-[min(720px,92vw)] h-[min(720px,82vh)]')
                : (threadRoot
                    ? 'w-[640px] h-[440px]'
                    : 'w-[320px] h-[440px]')
            } rounded-2xl border border-slate-200 dark:border-dark-border shadow-elevated`
        } bg-white dark:bg-dark-card flex overflow-hidden transition-[width,height] duration-200`}
      >
        {/* Main conversation column */}
        <div className="flex-1 min-w-0 flex flex-col">
          <ConversationHeader
            conversation={conversation}
            otherProfile={conversation.other_profile}
            online={online}
            canAssignTask={!isExternal && (conversation.kind === 'dm' || conversation.kind === 'group' || conversation.kind === 'hub')}
            onAssignTask={() => onAssignTask?.(conversation)}
            canAddTodo={isExternal && (conversation.kind === 'dm' || conversation.kind === 'group' || conversation.kind === 'hub')}
            onAddTodo={() => setTodoOpen(true)}
            onStartCall={callsEnabled ? startCall : undefined}
            callStarting={callStarting}
            onMinimize={() => onMinimize?.(conversation.id)}
            onClose={() => onClose?.(conversation.id)}
            dragHandleProps={dragHandleProps}
            isMaximized={isMaximized}
            onToggleMaximize={onToggleMaximize ? () => onToggleMaximize(conversation.id) : undefined}
            onOpenMembers={isGroup ? () => setMembersOpen(true) : undefined}
          />
          <WidgetPaneBody
            messages={messages}
            myId={profile?.id}
            loading={loading}
            hasMore={hasMore}
            loadMore={loadMore}
            deleteMessage={deleteMessage}
            otherLastReadAt={otherLastReadAt}
            lastReadAt={conversation.last_read_at ?? null}
            groupReaders={isGroup ? groupReaders : null}
            scrollRootRef={scrollRootRef}
            conversationId={conversation.id}
            profileLookup={profileLookup}
            openThread={openThread}
            scrollToMessage={scrollToMessage}
          />
          {otherTyping && <TypingIndicator names={typingNames} />}
          <ChatComposer
            conversationId={conversation.id}
            onSend={sendMessage}
            onTyping={emitTyping}
            mentionablePeople={mentionablePeople}
          />
        </div>
        {/* Thread column — slides in on the right when open */}
        {threadRoot && (
          <ThreadPanel
            conversation={conversation}
            rootMessage={threadRoot}
            onClose={closeThread}
            mentionablePeople={mentionablePeople}
            profileLookup={profileLookup}
          />
        )}
      </div>
      {isGroup && (
        <GroupMembersModal
          isOpen={membersOpen}
          onClose={() => setMembersOpen(false)}
          conversation={conversation}
          onLeft={(cid) => onClose?.(cid)}
          onChanged={() => onGroupChanged?.()}
        />
      )}
      {todoOpen && (
        <AssignTodoFromChatModal
          conversation={conversation}
          onClose={() => setTodoOpen(false)}
        />
      )}
    </ReplyProvider>
  )
}

/**
 * Inner body that consumes ReplyContext so MessageRow's hover toolbar can drive
 * quote-reply + jump. Mirrors SlackMessagePane's SlackPaneBody bridge exactly:
 * the new MessageRow takes onReply / onJumpToReply as props (the legacy
 * MessageList achieved this via DmChatMessage calling useReplyContext()
 * directly), so we bridge them here:
 *   onReply       → requestReply (pushes the quoted target into ChatComposer)
 *   onJumpToReply → scrollToMessage (same machinery the deep-link path uses)
 */
function WidgetPaneBody({
  messages, myId, loading, hasMore, loadMore, deleteMessage,
  otherLastReadAt, lastReadAt, groupReaders, scrollRootRef,
  conversationId, profileLookup, openThread, scrollToMessage,
}) {
  const { requestReply } = useReplyContext()
  return (
    <SlackMessageList
      messages={messages}
      myId={myId}
      loading={loading}
      hasMore={hasMore}
      onLoadMore={loadMore}
      onDelete={deleteMessage}
      otherLastReadAt={otherLastReadAt}
      lastReadAt={lastReadAt}
      groupReaders={groupReaders}
      scrollRootRef={scrollRootRef}
      conversationId={conversationId}
      profileLookup={profileLookup}
      onOpenThread={openThread}
      onReply={(message, targetName) => requestReply(message, targetName)}
      onJumpToReply={scrollToMessage}
    />
  )
}
