import { useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useConversation } from '../../hooks/useConversation'
import { useDmTyping } from '../../hooks/useDmTyping'
import { useOtherReadState } from '../../hooks/useOtherReadState'
import ConversationHeader from './ConversationHeader'
import MessageList from './MessageList'
import ChatComposer from './ChatComposer'
import TypingIndicator from './TypingIndicator'

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

  const otherName = conversation.other_profile?.full_name
    || conversation.other_profile?.email
    || 'Contact'

  return (
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
      />
      {otherTyping && <TypingIndicator name={otherName} />}
      <ChatComposer
        conversationId={conversation.id}
        onSend={sendMessage}
        onTyping={emitTyping}
      />
    </div>
  )
}
