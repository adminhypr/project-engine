import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { ArrowDown } from 'lucide-react'
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

  // Auto-scroll only when the reader is already near the bottom (or the new
  // message is their own). Scrolled-up readers keep their place and get a
  // "new messages" pill instead of being yanked to the bottom.
  const nearBottomRef = useRef(true)
  const initializedRef = useRef(false)
  const [unseenCount, setUnseenCount] = useState(0)
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null
  const lastId = lastMsg?.id ?? null
  const lastIsMine = lastMsg ? lastMsg.author_id === myId : false

  useEffect(() => {
    const root = scrollRootRef?.current
    if (!root) return
    const onScroll = () => {
      nearBottomRef.current = root.scrollHeight - root.scrollTop - root.clientHeight < 120
      if (nearBottomRef.current) setUnseenCount(0)
    }
    onScroll()
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
  }, [scrollRootRef, loading])

  useEffect(() => {
    if (!lastId) return
    const first = !initializedRef.current
    initializedRef.current = true
    // No scroll root (caller didn't wire one) falls back to always-scroll.
    if (first || lastIsMine || !scrollRootRef?.current || nearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' })
      setUnseenCount(0)
    } else {
      setUnseenCount(c => c + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId])

  const jumpToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    setUnseenCount(0)
  }

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
      {unseenCount > 0 && (
        <div className="sticky bottom-1 flex justify-center pointer-events-none">
          <button
            type="button"
            onClick={jumpToBottom}
            className="pointer-events-auto flex items-center gap-1 px-3 py-1.5 rounded-full bg-slate-900/90 dark:bg-slate-700 text-white text-xs font-medium shadow-elevated hover:bg-slate-900 dark:hover:bg-slate-600 transition-colors"
            aria-label={`${unseenCount} new ${unseenCount === 1 ? 'message' : 'messages'} — jump to latest`}
          >
            <ArrowDown size={13} aria-hidden="true" />
            {unseenCount} new {unseenCount === 1 ? 'message' : 'messages'}
          </button>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
