import { Link } from 'react-router-dom'
import { todoColorClass } from './todoColors'

function previewText(s) {
  if (!s) return ''
  return s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

export default function TodoListRow({ list, hubId }) {
  const total = list.totalItems
  const done = list.completedItems
  const pct = total ? Math.round((done / total) * 100) : 0
  const descPreview = previewText(list.description)

  return (
    <Link
      to={`/hub/${hubId}/todos/${list.id}`}
      className="block rounded-2xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card px-4 py-3.5 hover:border-brand-300 dark:hover:border-brand-500/40 transition-colors"
    >
      <div className="flex items-center gap-3">
        <span className={`w-3 h-3 rounded-full shrink-0 ${todoColorClass(list.color)}`} />
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{list.title}</h3>
          {descPreview && (
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">{descPreview}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-20 h-1.5 bg-slate-100 dark:bg-dark-border rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-slate-400 tabular-nums">{done}/{total}</span>
        </div>
      </div>
    </Link>
  )
}
