import { X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useThread } from '../../hooks/useThread'
import { useMessageReactions } from '../../hooks/useMessageReactions'
import MessageRow from './slack/MessageRow'
import ChatComposer from './ChatComposer'
import { ReplyProvider, useReplyContext } from './ReplyContext'
import { isLeadMessage } from '../../lib/messageGrouping'

// Slack-style thread flexpane. A fixed-width (~380px) flex sibling that PUSHES
// the message pane narrower (not an overlay). Header shows "Thread" + the
// conversation name, the root message sits at top above a divider, and replies
// render below using the SAME MessageRow + grouping as the main pane so the
// two surfaces feel identical.
function ThreadBody({
  conversation,
  rootMessage,
  onClose,
  mentionablePeople,
  profileLookup,
}) {
  const { profile } = useAuth()
  const { requestReply } = useReplyContext()
  const { root, replies, loading, sendMessage, deleteMessage, effectiveRootId } = useThread({
    conversationId: conversation.id,
    rootMessage,
  })
  // Same hook the main MessageList uses — gives us per-message aggregated
  // reactions plus a toggle for the current user.
  const { byMessageId, toggle } = useMessageReactions(conversation.id)

  const contextLabel = conversation.title
    || conversation.other_profile?.full_name
    || 'Conversation'

  const handleReply = (message, authorName) => requestReply(message, authorName)

  return (
    <div className="w-[380px] shrink-0 flex flex-col border-l border-slate-200 dark:border-dark-border bg-white dark:bg-dark-bg">
      <header className="h-[50px] shrink-0 px-4 flex items-center gap-2 border-b border-slate-200 dark:border-dark-border">
        <div className="flex-1 min-w-0">
          <div className="text-channel-hdr font-bold text-slate-900 dark:text-white leading-tight">Thread</div>
          <div className="text-[12px] text-slate-500 dark:text-slate-400 truncate">{contextLabel}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-8 h-8 grid place-items-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/10"
          aria-label="Close thread"
          title="Close thread (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="p-4 text-center text-sm text-slate-500">Loading thread…</div>
        ) : (
          <>
            {root && (
              <MessageRow
                message={root}
                isMine={root.author_id === profile?.id}
                myId={profile?.id}
                isLead
                reactions={byMessageId[root.id]}
                onToggleReaction={toggle}
                reactionProfileLookup={profileLookup}
                onReply={handleReply}
                onDelete={deleteMessage}
              />
            )}

            {/* Reply-count divider */}
            <div className="flex items-center gap-2 px-5 py-1 text-[12px] font-semibold text-slate-400 dark:text-slate-500">
              <span className="shrink-0">
                {replies.length === 0
                  ? 'No replies yet'
                  : `${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}`}
              </span>
              <span className="flex-1 h-px bg-slate-200 dark:bg-dark-border" />
            </div>

            {replies.map((m, i) => (
              <MessageRow
                key={m.id}
                message={m}
                isMine={m.author_id === profile?.id}
                myId={profile?.id}
                isLead={isLeadMessage(m, replies[i - 1] || null)}
                reactions={byMessageId[m.id]}
                onToggleReaction={toggle}
                reactionProfileLookup={profileLookup}
                onReply={handleReply}
                onDelete={deleteMessage}
              />
            ))}
          </>
        )}
      </div>

      <ChatComposer
        conversationId={conversation.id}
        onSend={sendMessage}
        mentionablePeople={mentionablePeople}
        threadRootId={effectiveRootId}
        placeholder="Reply…"
      />
    </div>
  )
}

export default function ThreadPanel(props) {
  return (
    <ReplyProvider scrollToMessage={() => {}}>
      <ThreadBody {...props} />
    </ReplyProvider>
  )
}
