import { useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from 'react'
import { ChevronDown } from 'lucide-react'
import MessageRow from './MessageRow'
import { useMessageReactions } from '../../../hooks/useMessageReactions'
import { useThreadCounts } from '../../../hooks/useThreadCounts'
import { computeSeenByMessage } from '../../../lib/groupSeenBy'
import { isLeadMessage } from '../../../lib/messageGrouping'
import { dividerLabel, firstUnreadId } from '../../../lib/messageDividers'

/**
 * Slack-style scrollable message list.
 *
 * Mirrors the props the legacy `MessageList` receives so the pane wiring
 * (`ConversationPane` → `SlackMessagePane` in Task 2.4) is a drop-in swap, with
 * two additions for the redesign:
 *   - `lastReadAt` — the CURRENT user's `last_read_at` for this conversation
 *     (drives the amber "New messages" line). The legacy list never received
 *     this; the caller (Task 2.4) must supply it from the conversation list
 *     entry's `last_read_at` (see report). Snapshotted on conversation change so
 *     the line stays put while you read.
 *   - `onReply` / `onJumpToReply` / `onMarkUnread` / `onEdit` — forwarded to
 *     `MessageRow`'s hover toolbar (optional; MessageRow stubs absent ones).
 *
 * Carried over verbatim from the legacy `MessageList`:
 *   - the scroll container + `scrollRootRef` ownership contract (the pane owns
 *     the ref so its `scrollToMessage` / `pe-chat-scroll-to-message` deep-link
 *     machinery can `querySelector('[data-message-id]')` inside it),
 *   - `data-message-id` on every rendered row (via MessageRow) so deep-link
 *     scrolling keeps working,
 *   - auto-scroll-to-bottom only when already near bottom or the new message is
 *     mine; scrolled-up readers keep their place + get the jump pill,
 *   - reactions (`useMessageReactions`), thread counts (`useThreadCounts`),
 *     per-message group "seen by" (`computeSeenByMessage`), and the
 *     latest-mine receipt selection,
 *   - "Load earlier" pagination.
 */
export default function SlackMessageList({
  messages,
  myId,
  loading,
  hasMore,
  onLoadMore,
  onDelete,
  otherLastReadAt,
  lastReadAt,
  scrollRootRef,
  conversationId,
  groupReaders,
  profileLookup,
  onOpenThread,
  onReply,
  onJumpToReply,
  onMarkUnread,
  onEdit,
  wallpaperBackground,
}) {
  const { byMessageId, toggle } = useMessageReactions(conversationId)
  const messageIds = useMemo(
    () => messages.filter(m => m.kind !== 'system' && !m.deleted_at).map(m => m.id),
    [messages]
  )
  const threadCounts = useThreadCounts(conversationId, messageIds)
  const bottomRef = useRef(null)

  // Auto-scroll only when the reader is already near the bottom (or the new
  // message is their own). Scrolled-up readers keep their place and get the
  // jump-to-bottom pill instead of being yanked down. (Carried from MessageList.)
  const nearBottomRef = useRef(true)
  const initializedRef = useRef(false)
  const [atBottom, setAtBottom] = useState(true)
  const [unseenCount, setUnseenCount] = useState(0)
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null
  const lastId = lastMsg?.id ?? null
  const lastIsMine = lastMsg ? lastMsg.author_id === myId : false

  // Scroll-position preservation across "Load earlier" prepends: remember the
  // distance from the bottom before a prepend, restore it after layout so the
  // viewport doesn't jump when older history is inserted at the top.
  const prevCountRef = useRef(messages.length)
  const restoreFromBottomRef = useRef(null)
  const loadingMoreRef = useRef(false)

  const requestLoadMore = () => {
    const root = scrollRootRef?.current
    if (root) restoreFromBottomRef.current = root.scrollHeight - root.scrollTop
    loadingMoreRef.current = true
    onLoadMore?.()
  }

  // Track scroll position: drives both the auto-scroll gate and the jump pill.
  // Also triggers "load earlier" when the reader reaches the very top.
  useEffect(() => {
    const root = scrollRootRef?.current
    if (!root) return
    const onScroll = () => {
      const near = root.scrollHeight - root.scrollTop - root.clientHeight < 120
      nearBottomRef.current = near
      setAtBottom(near)
      if (near) setUnseenCount(0)
      if (root.scrollTop < 80 && hasMore && !loadingMoreRef.current) {
        requestLoadMore()
      }
    }
    onScroll()
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => root.removeEventListener('scroll', onScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRootRef, loading, hasMore])

  // After a prepend (older history loaded), restore scroll position so the
  // reader stays anchored to the same message. Runs before paint to avoid flicker.
  useLayoutEffect(() => {
    const root = scrollRootRef?.current
    const grew = messages.length > prevCountRef.current
    if (root && loadingMoreRef.current && grew && restoreFromBottomRef.current != null) {
      root.scrollTop = root.scrollHeight - restoreFromBottomRef.current
      restoreFromBottomRef.current = null
      loadingMoreRef.current = false
    } else if (grew) {
      loadingMoreRef.current = false
    }
    prevCountRef.current = messages.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length])

  // Auto-scroll on first render + new tail messages (when near bottom / mine).
  // Distinct from the prepend path above: only fires on the latest-id change.
  useEffect(() => {
    if (!lastId) return
    const first = !initializedRef.current
    initializedRef.current = true
    if (loadingMoreRef.current) return // prepend, not a new tail message
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

  // Snapshot the unread cut on conversation change so the "New messages" line
  // anchors where the conversation was last left, not where it is now (which
  // would drift as onMarkRead advances last_read_at on open).
  const initialLastReadRef = useRef(lastReadAt)
  const snapConvRef = useRef(conversationId)
  if (snapConvRef.current !== conversationId) {
    snapConvRef.current = conversationId
    initialLastReadRef.current = lastReadAt
  }
  // The memo intentionally reads initialLastReadRef.current rather than taking
  // it as a dependency. The ref is (re)assigned synchronously a few lines above
  // in THIS render whenever conversationId changes, so by the time the memo body
  // runs it already holds the fresh snapshot for the current conversation. The
  // [messages, conversationId] deps are sufficient: the anchor only needs to
  // recompute when new messages arrive or the conversation switches — the
  // snapshot itself is constant for the lifetime of a given conversationId
  // (that's the whole point — it must NOT track later lastReadAt bumps).
  const unreadAnchorId = useMemo(
    () => firstUnreadId(messages, initialLastReadRef.current),
    [messages, conversationId]
  )

  // Per-message "seen by" map for group conversations. Empty Map for 1:1.
  const seenByMessage = useMemo(
    () => computeSeenByMessage(messages, groupReaders || [], myId),
    [messages, groupReaders, myId]
  )

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-4 text-center text-sm text-slate-500">
        Loading…
      </div>
    )
  }
  if (messages.length === 0) {
    return (
      <div
        className="relative flex-1 flex flex-col items-center justify-center gap-1 p-8 text-center"
        style={wallpaperBackground ? { background: wallpaperBackground } : undefined}
      >
        {wallpaperBackground && (
          <div className="absolute inset-0 bg-white/70 dark:bg-dark-bg/70 pointer-events-none" aria-hidden="true" />
        )}
        <div className="relative z-10 flex flex-col items-center gap-1">
        <span className="text-3xl" aria-hidden="true">👋</span>
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
          This is the very beginning of this conversation.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">Say hi to get things started.</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={scrollRootRef}
      className="relative flex-1 overflow-y-auto"
      style={wallpaperBackground ? { background: wallpaperBackground, backgroundAttachment: 'local' } : undefined}
    >
      <div className="relative min-h-full flex flex-col justify-end py-2">
      {/* Readability scrim — a semi-opaque theme-bg layer between the wallpaper
          and the message rows. As an absolute child of this min-h-full track it
          spans the full scrollable content height, so messages stay legible over
          an image in both light and dark. Rows render above it (relative z-10). */}
      {wallpaperBackground && (
        <div className="absolute inset-0 bg-white/72 dark:bg-dark-bg/72 pointer-events-none" aria-hidden="true" />
      )}
      {hasMore && (
        <div className="text-center mb-2">
          <button
            type="button"
            onClick={requestLoadMore}
            className="text-xs text-brand-500 hover:underline"
          >
            Load earlier
          </button>
        </div>
      )}

      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const isMine = m.author_id === myId
        const isLead = isLeadMessage(m, prev)
        const showDivider = !prev || dividerLabel(prev.created_at) !== dividerLabel(m.created_at)
        const showUnread = unreadAnchorId && m.id === unreadAnchorId

        return (
          <Fragment key={m.id}>
            {showDivider && (
              <div className="sticky top-2 z-30 flex items-center justify-center my-3 select-none pointer-events-none">
                <div className="absolute inset-x-3 top-1/2 h-px bg-slate-200 dark:bg-dark-border" />
                <span className="relative px-3 py-0.5 rounded-full bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border text-[11px] font-semibold text-slate-500 dark:text-slate-400 shadow-soft">
                  {dividerLabel(m.created_at)}
                </span>
              </div>
            )}

            {showUnread && (
              <div className="relative flex items-center my-2 px-3" role="separator" aria-label="New messages">
                <div className="flex-1 h-px bg-amber-400" />
                <span className="ml-2 text-[11px] font-bold uppercase tracking-wide text-amber-500 dark:text-amber-400">
                  New
                </span>
              </div>
            )}

            <MessageRow
              message={m}
              isMine={isMine}
              myId={myId}
              isLead={isLead}
              reactions={byMessageId[m.id]}
              onToggleReaction={toggle}
              reactionProfileLookup={profileLookup}
              threadInfo={threadCounts.get(m.id)}
              onOpenThread={onOpenThread}
              onReply={onReply}
              onJumpToReply={onJumpToReply}
              onDelete={onDelete}
              onMarkUnread={onMarkUnread}
              onEdit={onEdit}
              seenBy={seenByMessage.get(m.id)}
            />
          </Fragment>
        )
      })}

        <div ref={bottomRef} />
      </div>

      {/* Jump-to-bottom pill — floats over the pane when scrolled up. */}
      {!atBottom && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-24 right-6 z-30 flex items-center gap-1.5 rounded-full bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border text-slate-700 dark:text-slate-200 text-xs font-medium pl-3 pr-3.5 py-2 shadow-elevated hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
          aria-label={
            unseenCount > 0
              ? `${unseenCount} new ${unseenCount === 1 ? 'message' : 'messages'} — jump to latest`
              : 'Jump to latest'
          }
        >
          <ChevronDown size={14} aria-hidden="true" />
          {unseenCount > 0
            ? `${unseenCount} new ${unseenCount === 1 ? 'message' : 'messages'}`
            : 'Jump to latest'}
        </button>
      )}
    </div>
  )
}
