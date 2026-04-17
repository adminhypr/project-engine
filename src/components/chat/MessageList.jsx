import { useEffect, useRef } from 'react'
import DmChatMessage from './DmChatMessage'

export default function MessageList({ messages, myId, loading, hasMore, onLoadMore, onDelete }) {
  const bottomRef = useRef(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages.length])

  if (loading) {
    return <div className="p-4 text-center text-sm text-slate-500">Loading…</div>
  }
  if (messages.length === 0) {
    return <div className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">Say hi 👋</div>
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      {hasMore && (
        <div className="text-center mb-2">
          <button
            type="button"
            onClick={onLoadMore}
            className="text-xs text-brand-500 hover:underline"
          >
            Load earlier
          </button>
        </div>
      )}
      {messages.map(m => (
        <DmChatMessage
          key={m.id}
          message={m}
          isMine={m.author_id === myId}
          onDelete={onDelete}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
