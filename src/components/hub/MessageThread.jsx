import { useState, useRef } from 'react'
import { Pin, MessageSquare, Trash2 } from 'lucide-react'
import RichInput from '../ui/RichInput'
import RichContentRenderer from '../ui/RichContentRenderer'

export default function MessageThread({ message, hubId, isOwn, isManager, onReply, onDelete, onTogglePin, getReplies }) {
  const [expanded, setExpanded] = useState(false)
  const [replies, setReplies]   = useState([])
  const [replyText, setReplyText] = useState('')
  const [loadingReplies, setLoadingReplies] = useState(false)
  const [sending, setSending] = useState(false)
  const submitRef = useRef(null)

  const time = new Date(message.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  async function handleExpand() {
    if (!expanded) {
      setLoadingReplies(true)
      const data = await getReplies(message.id)
      setReplies(data)
      setLoadingReplies(false)
    }
    setExpanded(!expanded)
  }

  async function handleReply({ content, mentions, inlineImages }) {
    if (!content.trim() || sending) return
    setSending(true)
    await onReply(message.id, content, mentions, inlineImages)
    setReplyText('')
    const data = await getReplies(message.id)
    setReplies(data)
    setSending(false)
  }

  return (
    <div className={`rounded-xl border ${message.pinned ? 'border-amber-300 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5' : 'border-slate-200/60 dark:border-dark-border bg-white dark:bg-dark-card'} overflow-hidden`}>
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          {message.author?.avatar_url ? (
            <img src={message.author.avatar_url} className="w-8 h-8 rounded-full mt-0.5" alt="" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold mt-0.5">
              {message.author?.full_name?.[0] || '?'}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{message.author?.full_name}</span>
              <span className="text-xs text-slate-400 dark:text-slate-500">{time}</span>
              {message.pinned && <Pin size={12} className="text-amber-500" />}
            </div>
            {message.title && (
              <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-1">{message.title}</h4>
            )}
            <div className="text-sm text-slate-700 dark:text-slate-300 mt-1">
              <RichContentRenderer
                content={message.content}
                mentions={message.mentions}
                inlineImages={message.inline_images}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-2.5 ml-11">
          <button onClick={handleExpand} className="text-xs text-brand-500 hover:text-brand-600 dark:text-brand-400 font-medium flex items-center gap-1">
            <MessageSquare size={12} />
            {expanded ? 'Hide replies' : `Replies${message.reply_count ? ` (${message.reply_count})` : ''}`}
          </button>
          {(isOwn || isManager) && (
            <button onClick={() => onTogglePin(message.id, message.pinned)} className="text-xs text-slate-400 hover:text-amber-500 flex items-center gap-1">
              <Pin size={12} />
              {message.pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {isOwn && (
            <button onClick={() => onDelete(message.id)} className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1">
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-200/60 dark:border-dark-border px-4 py-3 bg-slate-50/50 dark:bg-dark-bg/50">
          {loadingReplies ? (
            <p className="text-xs text-slate-400">Loading...</p>
          ) : (
            <>
              {replies.length === 0 && (
                <p className="text-xs text-slate-400 mb-2">No replies yet.</p>
              )}
              <div className="space-y-2 mb-3">
                {replies.map(r => (
                  <div key={r.id} className="flex items-start gap-2">
                    {r.author?.avatar_url ? (
                      <img src={r.author.avatar_url} className="w-6 h-6 rounded-full mt-0.5" alt="" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-slate-300 dark:bg-dark-border flex items-center justify-center text-white text-xs font-bold mt-0.5">
                        {r.author?.full_name?.[0] || '?'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{r.author?.full_name}</span>
                        <span className="text-xs text-slate-400">{new Date(r.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-400">
                        <RichContentRenderer
                          content={r.content}
                          mentions={r.mentions}
                          inlineImages={r.inline_images}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <RichInput
                    value={replyText}
                    onChange={setReplyText}
                    onSubmit={handleReply}
                    submitRef={submitRef}
                    hubId={hubId}
                    enableMentions
                    enableImages
                    placeholder="Write a reply..."
                    className="text-xs py-1.5"
                    singleLine
                  />
                </div>
                <button
                  type="button"
                  onClick={() => submitRef.current?.()}
                  disabled={!replyText.trim() || sending}
                  className="btn btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
                >
                  Reply
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
