import { MessageSquare, CalendarDays } from 'lucide-react'
import { format, parseISO } from 'date-fns'

export default function CardPreview({ card, onClick }) {
  const due = card.due_date ? parseISO(card.due_date) : null
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left p-3 rounded-xl bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border hover:border-brand-300 dark:hover:border-brand-500 shadow-card transition-colors"
    >
      <div className="text-sm font-medium text-slate-900 dark:text-white line-clamp-2">{card.title}</div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1.5 min-w-0">
          {due && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={11} />
              {format(due, 'MMM d')}
            </span>
          )}
          {card.comment_count > 0 && (
            <span className="inline-flex items-center gap-1">
              <MessageSquare size={11} />
              {card.comment_count}
            </span>
          )}
        </div>
        <div className="flex -space-x-1.5 shrink-0">
          {(card.assignees || []).slice(0, 3).map(a => (
            <div
              key={a.id}
              title={a.full_name}
              className="w-5 h-5 rounded-full ring-2 ring-white dark:ring-dark-card bg-slate-200 dark:bg-slate-700 overflow-hidden"
            >
              {a.avatar_url
                ? <img src={a.avatar_url} alt="" className="w-full h-full object-cover" />
                : <span className="block text-[9px] font-bold text-slate-600 dark:text-slate-300 leading-5 text-center">{a.full_name?.[0] || '?'}</span>}
            </div>
          ))}
          {card.assignees?.length > 3 && (
            <div className="w-5 h-5 rounded-full ring-2 ring-white dark:ring-dark-card bg-slate-100 dark:bg-slate-800 text-[9px] font-semibold text-slate-500 leading-5 text-center">
              +{card.assignees.length - 3}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
