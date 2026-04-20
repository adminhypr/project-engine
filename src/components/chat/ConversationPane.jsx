import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useConversation } from '../../hooks/useConversation'
import { useDmTyping } from '../../hooks/useDmTyping'
import { useOtherReadState } from '../../hooks/useOtherReadState'
import ConversationHeader from './ConversationHeader'
import MessageList from './MessageList'
import ChatComposer from './ChatComposer'
import TypingIndicator from './TypingIndicator'
import GroupMembersModal from './GroupMembersModal'
import { ReplyProvider } from './ReplyContext'
import { groupDisplayName } from '../../lib/groupConversations'

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
}) {
  const { profile } = useAuth()
  const { messages, loading, hasMore, sendMessage, deleteMessage, loadMore } =
    useConversation(conversation.id)
  const isGroup = conversation.kind === 'group'
  // Typing + read receipts are DM-only for this pass. In groups they'd need
  // multi-user reasoning; we disable them cleanly via null IDs so the hooks
  // short-circuit on the first line of their effects.
  const { otherTyping, emitTyping } = useDmTyping(
    isGroup ? null : conversation.id,
    isGroup ? null : profile?.id,
  )
  const otherLastReadAt = useOtherReadState(
    isGroup ? null : conversation.id,
    isGroup ? null : conversation.other_user_id,
  )

  const [membersOpen, setMembersOpen] = useState(false)

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

  const typingName = isGroup
    ? groupDisplayName(conversation)
    : (conversation.other_profile?.full_name
      || conversation.other_profile?.email
      || 'Contact')

  return (
    <ReplyProvider scrollToMessage={scrollToMessage}>
      <div className={`${isMaximized
          ? 'w-[min(720px,92vw)] h-[min(720px,82vh)]'
          : 'w-[320px] h-[440px]'
        } bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-dark-border shadow-elevated flex flex-col overflow-hidden transition-[width,height] duration-200`}>
        <ConversationHeader
          conversation={conversation}
          otherProfile={conversation.other_profile}
          online={online}
          canAssignTask={conversation.kind === 'dm' || conversation.kind === 'group'}
          onAssignTask={() => onAssignTask?.(conversation)}
          onMinimize={() => onMinimize?.(conversation.id)}
          onClose={() => onClose?.(conversation.id)}
          dragHandleProps={dragHandleProps}
          isMaximized={isMaximized}
          onToggleMaximize={onToggleMaximize ? () => onToggleMaximize(conversation.id) : undefined}
          onOpenMembers={isGroup ? () => setMembersOpen(true) : undefined}
        />
        <MessageList
          messages={messages}
          myId={profile?.id}
          loading={loading}
          hasMore={hasMore}
          onLoadMore={loadMore}
          onDelete={deleteMessage}
          otherLastReadAt={otherLastReadAt}
          scrollRootRef={scrollRootRef}
          conversationId={conversation.id}
        />
        {otherTyping && <TypingIndicator name={typingName} />}
        <ChatComposer
          conversationId={conversation.id}
          onSend={sendMessage}
          onTyping={isGroup ? undefined : emitTyping}
          mentionablePeople={isGroup
            ? (conversation.participants || [])
                .filter(p => p.id && p.id !== profile?.id)
                .map(p => ({ id: p.id, full_name: p.full_name, avatar_url: p.avatar_url }))
            : []}
        />
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
    </ReplyProvider>
  )
}
