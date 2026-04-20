import { useCallback, useEffect, useRef } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useConversation } from '../../hooks/useConversation'
import { useDmTyping } from '../../hooks/useDmTyping'
import { useOtherReadState } from '../../hooks/useOtherReadState'
import ConversationHeader from './ConversationHeader'
import MessageList from './MessageList'
import ChatComposer from './ChatComposer'
import TypingIndicator from './TypingIndicator'
import { ReplyProvider } from './ReplyContext'

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
}) {
  const { profile } = useAuth()
  const { messages, loading, hasMore, sendMessage, deleteMessage, loadMore } =
    useConversation(conversation.id)
  const { otherTyping, emitTyping } = useDmTyping(conversation.id, profile?.id)
  const otherLastReadAt = useOtherReadState(conversation.id, conversation.other_user_id)

  useEffect(() => {
    onMarkRead?.(conversation.id)
  }, [conversation.id, messages.length, onMarkRead])

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

  const otherName = conversation.other_profile?.full_name
    || conversation.other_profile?.email
    || 'Contact'

  return (
    <ReplyProvider scrollToMessage={scrollToMessage}>
      <div className={`${isMaximized
          ? 'w-[min(720px,92vw)] h-[min(720px,82vh)]'
          : 'w-[320px] h-[440px]'
        } bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-dark-border shadow-elevated flex flex-col overflow-hidden transition-[width,height] duration-200`}>
        <ConversationHeader
          otherProfile={conversation.other_profile}
          online={online}
          canAssignTask={conversation.kind === 'dm'}
          onAssignTask={() => onAssignTask?.(conversation)}
          onMinimize={() => onMinimize?.(conversation.id)}
          onClose={() => onClose?.(conversation.id)}
          dragHandleProps={dragHandleProps}
          isMaximized={isMaximized}
          onToggleMaximize={onToggleMaximize ? () => onToggleMaximize(conversation.id) : undefined}
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
        />
        {otherTyping && <TypingIndicator name={otherName} />}
        <ChatComposer
          conversationId={conversation.id}
          onSend={sendMessage}
          onTyping={emitTyping}
        />
      </div>
    </ReplyProvider>
  )
}
