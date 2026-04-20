import { useState } from 'react'
import { Trash2, Check, CheckCheck, CornerUpLeft, SmilePlus } from 'lucide-react'
import RichContentRenderer from '../ui/RichContentRenderer'
import { renderChatInlineMarkdown, extractTaskIdFromMessage } from '../../lib/chatInlineMarkdown'
import ChatTaskCard from './ChatTaskCard'
import { useReplyContext } from './ReplyContext'
import ReactionPicker from './ReactionPicker'
import MessageReactions from './MessageReactions'
import SeenByAvatars from './SeenByAvatars'

function formatTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

function QuotedReply({ message, isMine, onJump }) {
  const hasRef = !!message.reply_to_id
  if (!hasRef) return null
  const author = message.reply_to_author?.full_name || 'Someone'
  const preview = message.reply_to_preview || 'message'
  return (
    <button
      type="button"
      onClick={() => onJump?.(message.reply_to_id)}
      className={`text-left max-w-full mb-0.5 rounded-lg border-l-2 pl-2 pr-2 py-1 text-[11px] leading-tight truncate hover:brightness-110 ${
        isMine
          ? 'border-brand-300 bg-brand-500/10 text-slate-600 dark:text-slate-300'
          : 'border-slate-300 dark:border-slate-500 bg-slate-50 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300'
      }`}
      title={`Reply to ${author}: ${preview}`}
    >
      <span className="block text-[10px] font-semibold opacity-70">
        ↪ Reply to {author}
      </span>
      <span className="block opacity-80 truncate">{preview}</span>
    </button>
  )
}

export default function DmChatMessage({ message, isMine, onDelete, receipt, reactions, onToggleReaction, reactionProfileLookup, myId, seenBy }) {
  const { requestReply, scrollToMessage } = useReplyContext()
  const [pickerOpen, setPickerOpen] = useState(false)
  const isSystem = message.kind === 'system'
  const isDeleted = !!message.deleted_at

  if (isSystem) {
    const linkedTaskId = extractTaskIdFromMessage(message.content)
    return (
      <div className="my-2 flex flex-col items-center" data-message-id={message.id}>
        <span className="inline-block px-3 py-1 text-xs rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-center">
          {renderChatInlineMarkdown(message.content)}
        </span>
        {linkedTaskId && <ChatTaskCard taskId={linkedTaskId} />}
      </div>
    )
  }

  const replyTargetName = isMine
    ? 'yourself'
    : (message.author?.full_name || 'them')

  return (
    <div
      className={`group flex my-2 ${isMine ? 'justify-end' : 'justify-start'}`}
      data-message-id={message.id}
    >
      <div className={`max-w-[75%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
        {!isMine && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
            {message.author?.full_name}
          </div>
        )}
        <QuotedReply message={message} isMine={isMine} onJump={scrollToMessage} />
        <div className="flex items-center gap-1">
          {/* Reply + React buttons (shown before the bubble for their messages, after for mine) */}
          {!isMine && !isDeleted && (
            <div className="relative flex items-center gap-1 order-1">
              <button
                type="button"
                onClick={() => requestReply(message, replyTargetName)}
                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-brand-500"
                aria-label="Reply"
                title="Reply"
              >
                <CornerUpLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setPickerOpen(v => !v)}
                className={`text-slate-400 hover:text-brand-500 ${pickerOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                aria-label="Add reaction"
                title="Add reaction"
              >
                <SmilePlus className="w-3.5 h-3.5" />
              </button>
              {pickerOpen && (
                <div className="absolute bottom-full left-0 mb-1 z-20">
                  <ReactionPicker
                    onPick={(emoji) => onToggleReaction?.(message.id, emoji)}
                    onClose={() => setPickerOpen(false)}
                  />
                </div>
              )}
            </div>
          )}
          <div className={`px-3 py-2 rounded-2xl text-sm ${
            isMine
              ? 'bg-brand-500 text-white'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
          }`}>
            {isDeleted ? (
              <span className="italic opacity-70">message deleted</span>
            ) : (
              <RichContentRenderer
                content={message.content || ''}
                mentions={message.mentions || []}
                inlineImages={message.inline_images || []}
                imagesBucket="dm-attachments"
              />
            )}
          </div>
          {isMine && !isDeleted && (
            <div className="relative flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPickerOpen(v => !v)}
                className={`text-slate-400 hover:text-brand-500 ${pickerOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                aria-label="Add reaction"
                title="Add reaction"
              >
                <SmilePlus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => requestReply(message, replyTargetName)}
                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-brand-500"
                aria-label="Reply"
                title="Reply"
              >
                <CornerUpLeft className="w-3.5 h-3.5" />
              </button>
              {pickerOpen && (
                <div className="absolute bottom-full right-0 mb-1 z-20">
                  <ReactionPicker
                    onPick={(emoji) => onToggleReaction?.(message.id, emoji)}
                    onClose={() => setPickerOpen(false)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        {!isDeleted && (
          <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
            <MessageReactions
              reactions={reactions}
              onToggle={(emoji) => onToggleReaction?.(message.id, emoji)}
              profileLookup={reactionProfileLookup}
              myUserId={myId}
            />
          </div>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-slate-400">{formatTime(message.created_at)}</span>
          {isMine && !isDeleted && receipt === 'seen' && (
            <span className="flex items-center gap-0.5 text-[10px] text-brand-500" title="Seen">
              <CheckCheck className="w-3 h-3" />
              Seen
            </span>
          )}
          {isMine && !isDeleted && receipt === 'delivered' && (
            <span className="flex items-center gap-0.5 text-[10px] text-slate-400" title="Delivered">
              <Check className="w-3 h-3" />
              Delivered
            </span>
          )}
          {isMine && !isDeleted && (
            <button
              type="button"
              onClick={() => onDelete(message.id)}
              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500"
              aria-label="Delete message"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
        {seenBy && seenBy.length > 0 && (
          <SeenByAvatars readers={seenBy} align={isMine ? 'end' : 'start'} />
        )}
      </div>
    </div>
  )
}
