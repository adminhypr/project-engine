import { useRef, useEffect, memo } from 'react'
import { useHubChat } from '../../hooks/useHubChat'
import { useAuth } from '../../hooks/useAuth'
import { Spinner } from '../ui/index'
import ChatMessage from './ChatMessage'
import ChatInput from './ChatInput'

function Campfire({ hubId }) {
  const { profile } = useAuth()
  const { messages, loading, sendMessage, deleteMessage, loadMore, hasMore } = useHubChat(hubId)
  const bottomRef = useRef(null)
  const containerRef = useRef(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  if (loading) return <div className="py-8 flex justify-center"><Spinner /></div>

  return (
    <div className="flex flex-col" style={{ maxHeight: 400 }}>
      <div ref={containerRef} className="flex-1 overflow-y-auto space-y-1 pr-1" style={{ minHeight: 0 }}>
        {hasMore && (
          <button onClick={loadMore} className="btn btn-ghost text-xs w-full mb-2">
            Load older messages
          </button>
        )}
        {messages.length === 0 && (
          <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6">
            No messages yet. Start the conversation!
          </p>
        )}
        {messages.map(msg => (
          <ChatMessage
            key={msg.id}
            message={msg}
            isOwn={msg.author_id === profile?.id}
            onDelete={deleteMessage}
          />
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-dark-border">
        <ChatInput hubId={hubId} onSend={sendMessage} />
      </div>
    </div>
  )
}

export default memo(Campfire)
