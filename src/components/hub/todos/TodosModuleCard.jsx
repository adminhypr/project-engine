import { Link } from 'react-router-dom'
import { useHubTodos } from '../../../hooks/useHubTodos'
import { todoColorClass } from './todoColors'
import { Spinner } from '../../ui/index'
import { ArrowRight } from 'lucide-react'

const PREVIEW_LIMIT = 5

const isOverdue  = d => d && new Date(d + 'T23:59:59') < new Date()
const isDueToday = d => d && d === new Date().toISOString().split('T')[0]
const fmt        = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null

export default function TodosModuleCard({ hubId }) {
  // Hub-scoped, NOT module-scoped: lists are created on the to-dos page,
  // which is hub-scoped (/hub/:hubId/todos has no module in the URL), so
  // every list has module_id = null. Filtering by module_id here matched
  // nothing and the card always showed "0 lists".
  const { lists, items, loading } = useHubTodos(hubId)

  if (loading) return <div className="py-6 flex justify-center"><Spinner /></div>

  const listById = new Map(lists.map(l => [l.id, l]))
  // Items are hub-scoped; drop any whose list was soft-deleted.
  const open = items.filter(i => !i.completed && listById.has(i.list_id))
  const preview = [...open]
    .sort((a, b) => {
      if (!!a.due_date !== !!b.due_date) return a.due_date ? -1 : 1
      if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date < b.due_date ? -1 : 1
      return 0
    })
    .slice(0, PREVIEW_LIMIT)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {lists.length} {lists.length === 1 ? 'list' : 'lists'} · {open.length} open
        </span>
        <Link
          to={`/hub/${hubId}/todos`}
          className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
        >
          Open <ArrowRight size={11} />
        </Link>
      </div>

      {lists.length === 0 ? (
        <Link to={`/hub/${hubId}/todos`} className="block text-center text-xs text-slate-400 py-4 hover:text-brand-600">
          No lists yet — Open to-dos
        </Link>
      ) : preview.length === 0 ? (
        <p className="text-center text-xs text-slate-400 py-4">All to-dos completed 🎉</p>
      ) : (
        <div className="space-y-0.5">
          {preview.map(item => {
            const list = listById.get(item.list_id)
            const overdue = isOverdue(item.due_date)
            const dueToday = isDueToday(item.due_date)
            return (
              <Link
                key={item.id}
                to={`/hub/${hubId}/todos/${item.list_id}/items/${item.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-dark-hover"
              >
                <span className="w-[14px] h-[14px] rounded border-2 shrink-0 border-slate-300 dark:border-slate-600" aria-hidden="true" />
                <span className="flex-1 min-w-0 text-sm text-slate-700 dark:text-slate-300 truncate">{item.title}</span>
                {item.due_date && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-medium ${
                    overdue ? 'bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400'
                    : dueToday ? 'bg-orange-100 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400'
                    : 'bg-slate-100 text-slate-500 dark:bg-dark-border dark:text-slate-400'
                  }`}>
                    {fmt(item.due_date)}
                  </span>
                )}
                <span className={`w-2 h-2 rounded-full shrink-0 ${todoColorClass(list?.color)}`} title={list?.title} />
              </Link>
            )
          })}
          {open.length > PREVIEW_LIMIT && (
            <Link
              to={`/hub/${hubId}/todos`}
              className="block px-2 pt-1.5 text-xs text-brand-600 dark:text-brand-400 hover:underline"
            >
              +{open.length - PREVIEW_LIMIT} more open to-dos
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
