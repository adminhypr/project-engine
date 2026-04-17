import { useEffect } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useConversation } from '../../hooks/useConversation'
import ConversationHeader from './ConversationHeader'
import MessageList from './MessageList'
import ChatComposer from './ChatComposer'

export default function ConversationPane({
  conversation,
  online,
  onClose,
  onMinimize,
  onMarkRead,
  onAssignTask,
}) {
  const { profile } = useAuth()
  const { messages, loading, hasMore, sendMessage, deleteMessage, loadMore } =
    useConversation(conversation.id)

  useEffect(() => {
    onMarkRead?.(conversation.id)
  }, [conversation.id, messages.length, onMarkRead])

  return (
    <div className="w-[320px] h-[440px] bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-dark-border shadow-elevated flex flex-col overflow-hidden">
      <ConversationHeader
        otherProfile={conversation.other_profile}
        online={online}
        canAssignTask={conversation.kind === 'dm'}
        onAssignTask={() => onAssignTask?.(conversation)}
        onMinimize={() => onMinimize?.(conversation.id)}
        onClose={() => onClose?.(conversation.id)}
      />
      <MessageList
        messages={messages}
        myId={profile?.id}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={loadMore}
        onDelete={deleteMessage}
      />
      <ChatComposer conversationId={conversation.id} onSend={sendMessage} />
    </div>
  )
}
