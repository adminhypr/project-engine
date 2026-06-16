import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, Check, CheckCheck, CornerUpLeft, SmilePlus, MessageSquare, Video } from 'lucide-react'
import RichContentRenderer from '../ui/RichContentRenderer'
import { renderChatInlineMarkdown, extractTaskIdFromMessage } from '../../lib/chatInlineMarkdown'
import { extractMeetUrl } from '../../lib/meetLink'
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

export default function DmChatMessage({ message, isMine, onDelete, receipt, reactions, onToggleReaction, reactionProfileLookup, myId, seenBy, threadInfo, onOpenThread }) {
  const { requestReply, scrollToMessage } = useReplyContext()
  const [pickerOpen, setPickerOpen] = useState(false)
  // Portal position for the reaction picker. The chat pane is narrow and
  // overflow-hidden, so an absolutely-positioned popover gets clipped at
  // the right edge — render it in a viewport-clamped fixed portal instead.
  const [pickerPos, setPickerPos] = useState(null)
  const triggerRef = useRef(null)
  const PICKER_W = 248
  const togglePicker = useCallback(() => {
    setPickerOpen(open => {
      if (open) return false
      const r = triggerRef.current?.getBoundingClientRect()
      if (r) {
        const left = Math.min(Math.max(8, r.left), window.innerWidth - PICKER_W - 8)
        setPickerPos({ top: r.top - 46, left })
      }
      return true
    })
  }, [])
  const isSystem = message.kind === 'system'
  const isCall = message.kind === 'call'
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

  if (isCall) {
    const url = extractMeetUrl(message.content)
    const who = isMine ? 'You' : (message.author?.full_name || 'Someone')
    return (
      <div className="my-2 flex justify-center" data-message-id={message.id}>
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-soft max-w-[90%]">
          <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Video className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{who} started a call</div>
            <div className="text-[11px] text-slate-400">{formatTime(message.created_at)}</div>
          </div>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 shrink-0 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium"
            >
              Join
            </a>
          )}
        </div>
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
      {pickerOpen && pickerPos && createPortal(
        <div className="fixed z-[9999]" style={{ top: pickerPos.top, left: pickerPos.left }}>
          <ReactionPicker
            onPick={(emoji) => onToggleReaction?.(message.id, emoji)}
            onClose={() => setPickerOpen(false)}
          />
        </div>,
        document.body
      )}
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
                ref={triggerRef}
                type="button"
                onClick={togglePicker}
                className={`text-slate-400 hover:text-brand-500 ${pickerOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                aria-label="Add reaction"
                title="Add reaction"
              >
                <SmilePlus className="w-3.5 h-3.5" />
              </button>
              {onOpenThread && (
                <button
                  type="button"
                  onClick={() => onOpenThread(message)}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-brand-500"
                  aria-label="Reply in thread"
                  title="Reply in thread"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
          <div className={`px-3 py-2 rounded-2xl text-sm min-w-0 break-words ${
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
                attachments={message.attachments || []}
                attachmentBucket="dm-attachments"
              />
            )}
          </div>
          {isMine && !isDeleted && (
            <div className="relative flex items-center gap-1">
              <button
                ref={triggerRef}
                type="button"
                onClick={togglePicker}
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
              {onOpenThread && (
                <button
                  type="button"
                  onClick={() => onOpenThread(message)}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-brand-500"
                  aria-label="Reply in thread"
                  title="Reply in thread"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
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
        {threadInfo && threadInfo.count > 0 && !isDeleted && (
          <button
            type="button"
            onClick={() => onOpenThread?.(message)}
            className={`mt-1 flex items-center gap-1.5 text-[11px] font-medium text-brand-600 dark:text-brand-300 hover:underline ${
              isMine ? 'self-end' : 'self-start'
            }`}
          >
            <MessageSquare className="w-3 h-3" />
            {threadInfo.count} repl{threadInfo.count === 1 ? 'y' : 'ies'}
          </button>
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
          {isMine && !isDeleted && onDelete && (
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
