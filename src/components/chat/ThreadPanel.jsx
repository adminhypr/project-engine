import { X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useThread } from '../../hooks/useThread'
import DmChatMessage from './DmChatMessage'
import ChatComposer from './ChatComposer'
import { ReplyProvider } from './ReplyContext'

// Slack-style thread panel. Renders the root message at the top, followed
// by a scrollable list of replies, and a composer pinned to the bottom.
// Sits next to the ConversationPane in the bottom-right widget column.
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

  return (
    <ReplyProvider scrollToMessage={() => {}}>
      <div className="w-[340px] h-[440px] bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-dark-border shadow-elevated flex flex-col overflow-hidden">
        <header className="px-3 py-2 border-b border-slate-200 dark:border-dark-border flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Thread</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {conversation.title || conversation.other_profile?.full_name || 'Conversation'}
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
              <div className="text-[11px] uppercase tracking-wide font-semibold text-slate-400 dark:text-slate-500 mb-1">
                {replies.length === 0
                  ? 'No replies yet'
                  : `${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}`}
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
        />
      </div>
    </ReplyProvider>
  )
}
