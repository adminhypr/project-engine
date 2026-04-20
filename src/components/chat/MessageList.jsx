import { useEffect, useRef, Fragment } from 'react'
import DmChatMessage from './DmChatMessage'
import DateSeparator, { isSameDay } from '../ui/DateSeparator'

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
      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const showSeparator = !prev || !isSameDay(prev.created_at, m.created_at)
        return (
          <Fragment key={m.id}>
            {showSeparator && <DateSeparator iso={m.created_at} />}
            <DmChatMessage
              message={m}
              isMine={m.author_id === myId}
              onDelete={onDelete}
            />
          </Fragment>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
