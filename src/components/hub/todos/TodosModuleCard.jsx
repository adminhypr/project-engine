import { Link } from 'react-router-dom'
import { useHubTodos } from '../../../hooks/useHubTodos'
import { todoColorClass } from './todoColors'
import { Spinner } from '../../ui/index'
import { ArrowRight } from 'lucide-react'

const PREVIEW_LIMIT = 5

export default function TodosModuleCard({ hubId }) {
  const { lists, items, loading } = useHubTodos(hubId)

  if (loading) return <div className="py-6 flex justify-center"><Spinner /></div>

  const enriched = lists.slice(0, PREVIEW_LIMIT).map(list => {
    const listItems = items.filter(i => i.list_id === list.id)
    return {
      ...list,
      totalItems: listItems.length,
      completedItems: listItems.filter(i => i.completed).length,
    }
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-slate-400 dark:text-slate-500">
          {lists.length} {lists.length === 1 ? 'list' : 'lists'}
        </span>
        <Link
          to={`/hub/${hubId}/todos`}
          className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
        >
          Open <ArrowRight size={11} />
        </Link>
      </div>

      {enriched.length === 0 ? (
        <Link to={`/hub/${hubId}/todos`} className="block text-center text-xs text-slate-400 py-4 hover:text-brand-600">
          No lists yet — Open to-dos
        </Link>
      ) : (
        <div className="space-y-2">
          {enriched.map(list => {
            const pct = list.totalItems ? Math.round((list.completedItems / list.totalItems) * 100) : 0
            return (
              <Link
                key={list.id}
                to={`/hub/${hubId}/todos/${list.id}`}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-dark-hover"
              >
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${todoColorClass(list.color)}`} />
                <span className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate">{list.title}</span>
                <div className="w-14 h-1 bg-slate-100 dark:bg-dark-border rounded-full overflow-hidden">
                  <div className={`h-full ${pct === 100 ? 'bg-green-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[10px] text-slate-400 tabular-nums w-8 text-right">{list.completedItems}/{list.totalItems}</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
