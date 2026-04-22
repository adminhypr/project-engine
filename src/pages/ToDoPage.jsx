import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useMyHubTodos } from '../hooks/useMyHubTodos'
import { groupTodosByHub, filterTodosByStatus, filterTodosByDue } from '../lib/myTodos'
import { PageHeader } from '../components/ui'
import { PageTransition } from '../components/ui/animations'
import { getPriority } from '../lib/priority'
import { CheckCircle2, Circle, Calendar, Boxes } from 'lucide-react'
import { formatDate } from '../lib/helpers'

export default function ToDoPage() {
  const { profile } = useAuth()
  const { items, loading, error } = useMyHubTodos()
  const [status, setStatus] = useState('open')
  const [due, setDue] = useState('all')

  const filtered = useMemo(() => {
    let out = items
    out = filterTodosByStatus(out, status)
    out = filterTodosByDue(out, due)
    return out
  }, [items, status, due])

  const grouped = useMemo(() => groupTodosByHub(filtered), [filtered])

  return (
    <PageTransition>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto">
        <PageHeader
          title="To-Do"
          subtitle={`${profile?.full_name?.split(' ')[0] || 'Hello'}, here are the items assigned to you.`}
        />

        <div className="flex flex-wrap gap-2 my-4">
          {['open', 'all', 'completed'].map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                status === s
                  ? 'bg-brand-500 text-white'
                  : 'bg-white dark:bg-dark-surface border border-slate-200 dark:border-dark-border text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover'
              }`}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
          <span className="mx-2 w-px bg-slate-200 dark:bg-dark-border" />
          {[
            { v: 'all', l: 'All due' },
            { v: 'overdue', l: 'Overdue' },
            { v: 'week', l: 'This week' },
            { v: 'none', l: 'No due date' },
          ].map(d => (
            <button
              key={d.v}
              onClick={() => setDue(d.v)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${
                due === d.v
                  ? 'bg-brand-500 text-white'
                  : 'bg-white dark:bg-dark-surface border border-slate-200 dark:border-dark-border text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover'
              }`}
            >
              {d.l}
            </button>
          ))}
        </div>

        {loading && <div className="text-sm text-slate-500">Loading...</div>}
        {error && <div className="text-sm text-red-500">Failed to load to-dos.</div>}

        {!loading && !error && grouped.length === 0 && (
          <div className="text-center py-12 text-slate-500 dark:text-slate-400">
            <Boxes className="mx-auto mb-3" size={32} />
            <p className="font-medium">No to-dos in this workspace.</p>
            <p className="text-sm mt-1">If you&apos;re expecting some, ask your Team Leader.</p>
          </div>
        )}

        <div className="space-y-6">
          {grouped.map(group => (
            <div key={group.hub.id}>
              <Link
                to={`/hub/${group.hub.id}`}
                className="text-xs uppercase tracking-wide font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              >
                {group.hub.name}
              </Link>
              <div className="mt-2 space-y-3">
                {group.lists.map(list => (
                  <div key={list.list.id} className="bg-white dark:bg-dark-surface border border-slate-200 dark:border-dark-border rounded-2xl overflow-hidden">
                    <div className="px-4 py-2 border-b border-slate-100 dark:border-dark-border text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {list.list.title}
                    </div>
                    <ul className="divide-y divide-slate-100 dark:divide-dark-border">
                      {list.items.map(item => {
                        const p = getPriority(item)
                        return (
                          <li key={item.id}>
                            <Link
                              to={`/hub/${group.hub.id}/todos/${list.list.id}/items/${item.id}`}
                              className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-dark-hover"
                            >
                              {item.completed_at
                                ? <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0" />
                                : <Circle size={18} className="text-slate-300 dark:text-slate-600 flex-shrink-0" />}
                              <span className={`flex-1 text-sm ${item.completed_at ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-100'}`}>
                                {item.title}
                              </span>
                              {item.due_date && (
                                <span className={`inline-flex items-center gap-1 text-xs font-medium priority-${p} px-2 py-0.5 rounded-full`}>
                                  <Calendar size={12} />
                                  {formatDate(item.due_date)}
                                </span>
                              )}
                            </Link>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageTransition>
  )
}
