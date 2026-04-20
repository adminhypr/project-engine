import { Trash2, Check, CheckCheck } from 'lucide-react'
import RichContentRenderer from '../ui/RichContentRenderer'
import { renderChatInlineMarkdown, extractTaskIdFromMessage } from '../../lib/chatInlineMarkdown'
import ChatTaskCard from './ChatTaskCard'

function formatTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

export default function DmChatMessage({ message, isMine, onDelete, receipt }) {
  const isSystem = message.kind === 'system'
  const isDeleted = !!message.deleted_at

  if (isSystem) {
    const linkedTaskId = extractTaskIdFromMessage(message.content)
    return (
      <div className="my-2 flex flex-col items-center">
        <span className="inline-block px-3 py-1 text-xs rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-center">
          {renderChatInlineMarkdown(message.content)}
        </span>
        {linkedTaskId && <ChatTaskCard taskId={linkedTaskId} />}
      </div>
    )
  }

  return (
    <div className={`group flex my-2 ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] ${isMine ? 'items-end' : 'items-start'} flex flex-col`}>
        {!isMine && (
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
            {message.author?.full_name}
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
      </div>
    </div>
  )
}
