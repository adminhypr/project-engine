import { useEffect, useMemo, useRef, Fragment } from 'react'
import DmChatMessage from './DmChatMessage'
import DateSeparator, { isSameDay } from '../ui/DateSeparator'
import { useMessageReactions } from '../../hooks/useMessageReactions'
import { useThreadCounts } from '../../hooks/useThreadCounts'
import { computeSeenByMessage } from '../../lib/groupSeenBy'

export default function MessageList({
  messages, myId, loading, hasMore, onLoadMore, onDelete, otherLastReadAt, scrollRootRef,
  conversationId, groupReaders, profileLookup, onOpenThread,
}) {
  const { byMessageId, toggle } = useMessageReactions(conversationId)
  const messageIds = useMemo(
    () => messages.filter(m => m.kind !== 'system' && !m.deleted_at).map(m => m.id),
    [messages]
  )
  const threadCounts = useThreadCounts(conversationId, messageIds)
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

  // Per-message "seen by" map for group conversations. For 1:1 we rely on the
  // single-checkmark receipt above; this stays an empty Map there.
  const seenByMessage = useMemo(
    () => computeSeenByMessage(messages, groupReaders || [], myId),
    [messages, groupReaders, myId]
  )

  if (loading) {
    return <div className="p-4 text-center text-sm text-slate-500">Loading…</div>
  }
  if (messages.length === 0) {
    return <div className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">Say hi 👋</div>
  }

  return (
    <div ref={scrollRootRef} className="flex-1 overflow-y-auto px-3 py-2">
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
        // Only show receipts in 1:1 DMs, where otherLastReadAt is populated
        // by useOtherReadState. In groups the hook is intentionally skipped
        // (single "Delivered" label makes no sense across N participants).
        const showReceipt = isMine && m.id === latestMineId && !!otherLastReadAt
        const seen = showReceipt && m.created_at <= otherLastReadAt
        return (
          <Fragment key={m.id}>
            {showSeparator && <DateSeparator iso={m.created_at} />}
            <DmChatMessage
              message={m}
              isMine={isMine}
              onDelete={onDelete}
              receipt={showReceipt ? (seen ? 'seen' : 'delivered') : null}
              reactions={byMessageId[m.id]}
              onToggleReaction={toggle}
              reactionProfileLookup={profileLookup}
              myId={myId}
              seenBy={seenByMessage.get(m.id)}
              threadInfo={threadCounts.get(m.id)}
              onOpenThread={onOpenThread}
            />
          </Fragment>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
