import { Link } from 'react-router-dom'

const isOverdue  = d => d && new Date(d + 'T23:59:59') < new Date()
const isDueToday = d => d && d === new Date().toISOString().split('T')[0]
const fmt        = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null

export default function TodoItemRow({ item, hubId, listId, onToggle }) {
  const assignees = item.hub_todo_item_assignees || []
  const overdue = !item.completed && isOverdue(item.due_date)
  const dueToday = !item.completed && isDueToday(item.due_date)

  return (
    <div className="group flex items-center gap-2 px-4 py-2 hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors border-b border-slate-100 dark:border-dark-border last:border-b-0">
      <button
        onClick={e => { e.preventDefault(); onToggle(item.id, item.completed) }}
        className={`w-[18px] h-[18px] rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
          item.completed
            ? 'bg-green-500 border-green-500 text-white'
            : 'border-slate-300 dark:border-slate-600 hover:border-brand-500'
        }`}
      >
        {item.completed && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5L4 7L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      <Link to={`/hub/${hubId}/todos/${listId}/items/${item.id}`} className="flex-1 min-w-0 flex items-center gap-2">
        <span className={`text-sm truncate ${item.completed ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-300'}`}>
          {item.title}
        </span>
        {item.due_date && !item.completed && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full shrink-0 font-medium ${
            overdue ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400'
            : dueToday ? 'bg-orange-100 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400'
            : 'bg-slate-100 text-slate-500 dark:bg-dark-border dark:text-slate-400'
          }`}>
            {fmt(item.due_date)}
          </span>
        )}
      </Link>

      {assignees.length > 0 && (
        <div className="flex -space-x-1.5 shrink-0">
          {assignees.slice(0, 3).map(a => {
            const p = a.profiles || a.profile
            if (!p) return null
            return p.avatar_url ? (
              <img key={p.id} src={p.avatar_url} className="w-5 h-5 rounded-full ring-2 ring-white dark:ring-dark-card" alt={p.full_name} title={p.full_name} />
            ) : (
              <div key={p.id} title={p.full_name} className="w-5 h-5 rounded-full bg-brand-500 ring-2 ring-white dark:ring-dark-card flex items-center justify-center text-white text-[9px] font-bold">
                {p.full_name?.[0] || '?'}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
