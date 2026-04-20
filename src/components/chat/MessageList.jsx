import { useEffect, useMemo, useRef, Fragment } from 'react'
import DmChatMessage from './DmChatMessage'
import DateSeparator, { isSameDay } from '../ui/DateSeparator'

export default function MessageList({
  messages, myId, loading, hasMore, onLoadMore, onDelete, otherLastReadAt,
}) {
  const bottomRef = useRef(null)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages.length])

  // Receipt is displayed only on my latest sent (non-deleted, non-system)
  // message to avoid per-bubble clutter — matches Messenger/iMessage UX.
  const latestMineId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.author_id === myId && m.kind !== 'system' && !m.deleted_at) return m.id
    }
    return null
  }, [messages, myId])

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
        const isMine = m.author_id === myId
        const showReceipt = isMine && m.id === latestMineId
        const seen = showReceipt && otherLastReadAt && m.created_at <= otherLastReadAt
        return (
          <Fragment key={m.id}>
            {showSeparator && <DateSeparator iso={m.created_at} />}
            <DmChatMessage
              message={m}
              isMine={isMine}
              onDelete={onDelete}
              receipt={showReceipt ? (seen ? 'seen' : 'delivered') : null}
            />
          </Fragment>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
