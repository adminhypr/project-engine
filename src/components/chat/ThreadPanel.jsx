import { X, MessagesSquare } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useThread } from '../../hooks/useThread'
import DmChatMessage from './DmChatMessage'
import ChatComposer from './ChatComposer'
import { ReplyProvider } from './ReplyContext'

// Thread column rendered INSIDE the ConversationPane card (Slack-style
// split layout). Styled distinctly from the main chat — subtle tinted
// background, brand-colored top accent bar, prominent left divider, and
// a "Thread" label — so it's immediately recognizable as a side view of
// one specific message rather than a second regular chat.
export default function ThreadPanel({
  conversation,
  rootMessage,
  onClose,
  mentionablePeople,
  profileLookup,
}) {
  const { profile } = useAuth()
  const { root, replies, loading, sendMessage, deleteMessage, effectiveRootId } = useThread({
    conversationId: conversation.id,
    rootMessage,
  })

  const contextLabel = conversation.title
    || conversation.other_profile?.full_name
    || 'Conversation'

  return (
    <ReplyProvider scrollToMessage={() => {}}>
      <div className="flex-1 min-w-0 flex flex-col border-l-2 border-brand-500/40 bg-slate-50 dark:bg-slate-800/40 relative">
        {/* Brand accent bar — a clear visual marker that this column is a thread. */}
        <div className="absolute inset-x-0 top-0 h-0.5 bg-brand-500/70" aria-hidden="true" />
        <header className="px-3 py-2 border-b border-slate-200 dark:border-dark-border flex items-center gap-2">
          <MessagesSquare className="w-4 h-4 text-brand-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-brand-600 dark:text-brand-300">Thread</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              in {contextLabel}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close thread"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="p-4 text-center text-sm text-slate-500">Loading thread…</div>
          ) : (
            <>
              {root && (
                <div className="pb-2 mb-2 border-b border-slate-200/70 dark:border-dark-border/70">
                  <DmChatMessage
                    message={root}
                    isMine={root.author_id === profile?.id}
                    onDelete={deleteMessage}
                    receipt={null}
                    reactions={null}
                    onToggleReaction={null}
                    reactionProfileLookup={profileLookup}
                    myId={profile?.id}
                  />
                </div>
              )}
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 mb-1">
                <span className="flex-1 h-px bg-slate-200 dark:bg-dark-border" />
                <span>
                  {replies.length === 0
                    ? 'No replies yet'
                    : `${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}`}
                </span>
                <span className="flex-1 h-px bg-slate-200 dark:bg-dark-border" />
              </div>
              {replies.map(m => (
                <DmChatMessage
                  key={m.id}
                  message={m}
                  isMine={m.author_id === profile?.id}
                  onDelete={deleteMessage}
                  receipt={null}
                  reactions={null}
                  onToggleReaction={null}
                  reactionProfileLookup={profileLookup}
                  myId={profile?.id}
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
          placeholder="Reply to thread…"
        />
      </div>
    </ReplyProvider>
  )
}
