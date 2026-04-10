import { Trash2 } from 'lucide-react'

export default function ChatMessage({ message, isOwn, onDelete }) {
  const time = new Date(message.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

  return (
    <div className={`group flex items-start gap-2.5 py-1.5 px-2 rounded-xl hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors ${isOwn ? '' : ''}`}>
      {message.author?.avatar_url ? (
        <img src={message.author.avatar_url} className="w-7 h-7 rounded-full mt-0.5 shrink-0" alt="" />
      ) : (
        <div className="w-7 h-7 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold mt-0.5 shrink-0">
          {message.author?.full_name?.[0] || '?'}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            {message.author?.full_name || 'Unknown'}
          </span>
          <span className="text-xs text-slate-400 dark:text-slate-500">{time}</span>
        </div>
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
        </p>
      </div>
      {isOwn && (
        <button
          onClick={() => onDelete(message.id)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-all shrink-0"
          title="Delete message"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}
