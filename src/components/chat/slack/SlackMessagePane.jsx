import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { showToast } from '../../ui'
import { useAuth } from '../../../hooks/useAuth'
import { useConversation } from '../../../hooks/useConversation'
import { useConversationMedia } from '../../../hooks/useConversationMedia'
import { useConversationWallpaper } from '../../../hooks/useConversationWallpaper'
import { useDmTyping } from '../../../hooks/useDmTyping'
import { useOtherReadState } from '../../../hooks/useOtherReadState'
import { useGroupReadState } from '../../../hooks/useGroupReadState'
import TypingIndicator from '../TypingIndicator'
import GroupMembersModal from '../GroupMembersModal'
import AssignTodoFromChatModal from '../AssignTodoFromChatModal'
import ThreadPanel from '../ThreadPanel'
import ChatComposer from '../ChatComposer'
import { ReplyProvider, useReplyContext } from '../ReplyContext'
import ChannelHeader from './ChannelHeader'
import SlackMessageList from './SlackMessageList'
import WallpaperPicker from './WallpaperPicker'
import FilesPanel from './FilesPanel'
import LinksPanel from './LinksPanel'

/**
 * Slack-style message pane for the full-page /chat experience (Task 2.4).
 *
 * Composes ChannelHeader (top) + SlackMessageList (middle, scrolls) +
 * ChatComposer (bottom) + ThreadPanel (right flexpane when a thread is open).
 *
 * Hook wiring is a 1:1 replication of the legacy `ConversationPane` — only the
 * three presentation children differ (ConversationHeader → ChannelHeader,
 * MessageList → SlackMessageList, ChatComposer unchanged). Every hook, handler,
 * effect, and prop that drove the old pane is preserved here so messages, send,
 * delete, reactions, typing, threads, mark-read, and deep-link scroll keep
 * working end-to-end.
 *
 * NEW prop vs ConversationPane: `lastReadAt` — the current user's read cursor
 * for this conversation (passed by ChatPage from the conversation row's
 * `last_read_at`). Forwarded to SlackMessageList for its "New" divider.
 *
 * Read-receipt decision: the legacy MessageList rendered per-message 1:1
 * ✓/✓✓ receipts; MessageRow has no receipt prop and Slack doesn't show them, so
 * per-message receipts are intentionally DROPPED in favor of Slack fidelity.
 * `useOtherReadState` / `useGroupReadState` are still consumed (groupReaders
 * drives the per-message "seen by" map SlackMessageList already computes via
 * computeSeenByMessage).
 */
export default function SlackMessagePane({
  conversation,
  online,
  status,
  onMarkRead,
  onAssignTask,
  onGroupChanged,
  lastReadAt,
  threadRoot,
  onOpenThread,
  onCloseThread,
}) {
  const { profile, isExternal } = useAuth()
  const { messages, loading, hasMore, sendMessage, deleteMessage, loadMore } =
    useConversation(conversation.id)
  const isGroup = conversation.kind === 'group' || conversation.kind === 'hub'

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

  // Header tab: Messages (default) | Files | Links. Reset to Messages whenever
  // the conversation changes so a left-on Files tab doesn't carry across rooms.
  const [tab, setTab] = useState('messages')
  // Lazy media fetch: only query dm_messages for files/links once the user
  // first opens a non-Messages tab in this conversation. `mediaActive` flips
  // true on first open and resets when the conversation id changes.
  const [mediaActive, setMediaActive] = useState(false)
  useEffect(() => {
    setTab('messages')
    setMediaActive(false)
  }, [conversation.id])
  const { files, links, loading: mediaLoading } = useConversationMedia(
    mediaActive ? conversation.id : null,
  )
  const handleTabChange = useCallback((next) => {
    if (next !== 'messages') setMediaActive(true)
    setTab(next)
  }, [])

  const [membersOpen, setMembersOpen] = useState(false)
  const [todoOpen, setTodoOpen] = useState(false)
  const [wallpaperOpen, setWallpaperOpen] = useState(false)
  const { resolvedBackground, wallpaper, setPreset, uploadImage, removeWallpaper, busy: wallpaperBusy } =
    useConversationWallpaper(conversation.id, conversation.wallpaper)
  const [callStarting, setCallStarting] = useState(false)
  const callsEnabled = import.meta.env.VITE_CALLS_ENABLED === 'true'

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

  const openThread = useCallback((message) => {
    if (!message || !onOpenThread) return
    onOpenThread(message)
  }, [onOpenThread])
  const closeThread = onCloseThread || (() => {})

  useEffect(() => {
    onMarkRead?.(conversation.id)
  }, [conversation.id, messages.length, onMarkRead])

  // Jump-to-message: same machinery as ConversationPane. DOM first, page back
  // through history until the target shows up or we exhaust it. scrollRootRef
  // scopes the smooth scroll to THIS pane's message list.
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

  // Deep-link bridge: ChatPage/widget dispatches pe-chat-scroll-to-message
  // after opening the conversation. Filtered to this pane's conversation id.
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

  // otherLastReadAt is referenced to keep the receipt hooks live (and so a
  // future Slack-style "Seen" line could read it); receipts are intentionally
  // not rendered per-message (see component doc comment).
  void otherLastReadAt

  return (
    <ReplyProvider scrollToMessage={scrollToMessage}>
      <div className="w-full h-full bg-white dark:bg-dark-bg flex overflow-hidden">
        {/* Main conversation column */}
        <div className="flex-1 min-w-0 flex flex-col">
          <ChannelHeader
            conversation={conversation}
            otherProfile={conversation.other_profile}
            online={online}
            status={status}
            canAssignTask={!isExternal && (conversation.kind === 'dm' || conversation.kind === 'group' || conversation.kind === 'hub')}
            onAssignTask={() => onAssignTask?.(conversation)}
            canAddTodo={isExternal && (conversation.kind === 'dm' || conversation.kind === 'group' || conversation.kind === 'hub')}
            onAddTodo={() => setTodoOpen(true)}
            onStartCall={callsEnabled ? startCall : undefined}
            callStarting={callStarting}
            onSetWallpaper={() => setWallpaperOpen(true)}
            onOpenMembers={isGroup ? () => setMembersOpen(true) : undefined}
            activeTab={tab}
            onTabChange={handleTabChange}
            fileCount={mediaActive ? files.length : undefined}
            linkCount={mediaActive ? links.length : undefined}
          />
          {tab === 'messages' ? (
            <>
              <SlackPaneBody
                messages={messages}
                myId={profile?.id}
                loading={loading}
                hasMore={hasMore}
                loadMore={loadMore}
                deleteMessage={deleteMessage}
                otherLastReadAt={otherLastReadAt}
                lastReadAt={lastReadAt}
                groupReaders={isGroup ? groupReaders : null}
                scrollRootRef={scrollRootRef}
                conversationId={conversation.id}
                profileLookup={profileLookup}
                openThread={openThread}
                scrollToMessage={scrollToMessage}
                wallpaperBackground={resolvedBackground}
              />
              {otherTyping && <TypingIndicator names={typingNames} />}
              <ChatComposer
                conversationId={conversation.id}
                onSend={sendMessage}
                onTyping={emitTyping}
                mentionablePeople={mentionablePeople}
              />
            </>
          ) : tab === 'files' ? (
            <FilesPanel files={files} loading={mediaLoading} />
          ) : (
            <LinksPanel links={links} loading={mediaLoading} />
          )}
        </div>
        {/* Thread column — flex sibling that PUSHES the pane on desktop */}
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
          onChanged={() => onGroupChanged?.()}
        />
      )}
      {todoOpen && (
        <AssignTodoFromChatModal
          conversation={conversation}
          onClose={() => setTodoOpen(false)}
        />
      )}
      <WallpaperPicker
        isOpen={wallpaperOpen}
        onClose={() => setWallpaperOpen(false)}
        wallpaper={wallpaper}
        busy={wallpaperBusy}
        onSetPreset={setPreset}
        onUploadImage={uploadImage}
        onRemove={removeWallpaper}
      />
    </ReplyProvider>
  )
}

/**
 * Inner body that consumes ReplyContext so MessageRow's hover toolbar can drive
 * quote-reply + jump. The legacy MessageList achieved this via DmChatMessage
 * calling useReplyContext() directly; the new MessageRow takes onReply /
 * onJumpToReply as props instead, so we bridge them here:
 *   onReply       → requestReply (pushes the quoted target into ChatComposer)
 *   onJumpToReply → scrollToMessage (same machinery the deep-link path uses)
 */
function SlackPaneBody({
  messages, myId, loading, hasMore, loadMore, deleteMessage,
  otherLastReadAt, lastReadAt, groupReaders, scrollRootRef,
  conversationId, profileLookup, openThread, scrollToMessage,
  wallpaperBackground,
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
      wallpaperBackground={wallpaperBackground}
    />
  )
}
