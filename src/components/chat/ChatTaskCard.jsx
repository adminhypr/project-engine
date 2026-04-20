import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Calendar, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { getPriority } from '../../lib/priority'
import { formatDateShort } from '../../lib/helpers'

// Module-level cache so multiple system messages referencing the same task
// share a single request. Keys are task UUIDs, values are either a pending
// Promise<row|null> or the resolved row/null.
const cache = new Map()

async function loadTask(taskId) {
  if (cache.has(taskId)) return cache.get(taskId)
  const p = supabase
    .from('tasks')
    .select('id, task_id, title, urgency, due_date, status, last_updated, assignee:profiles!tasks_assigned_to_fkey(id, full_name, avatar_url)')
    .eq('id', taskId)
    .maybeSingle()
    .then(({ data }) => {
      cache.set(taskId, data || null)
      return data || null
    })
  cache.set(taskId, p)
  return p
}

const URGENCY_STYLES = {
  High: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  Med:  'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400',
  Low:  'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
}

const PRIORITY_BAR = {
  red:    'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-400',
  green:  'bg-emerald-500',
  none:   'bg-slate-300 dark:bg-slate-600',
}

export default function ChatTaskCard({ taskId }) {
  const [task, setTask] = useState(() => {
    const c = cache.get(taskId)
    return c && typeof c.then !== 'function' ? c : null
  })
  const [loading, setLoading] = useState(task === null && !cache.has(taskId))

  useEffect(() => {
    let alive = true
    if (!taskId) return
    const cached = cache.get(taskId)
    if (cached && typeof cached.then !== 'function') {
      setTask(cached)
      setLoading(false)
      return
    }
    setLoading(true)
    loadTask(taskId).then(row => {
      if (!alive) return
      setTask(row)
      setLoading(false)
    })
    return () => { alive = false }
  }, [taskId])

  if (loading) {
    return (
      <div className="mt-1 mx-auto max-w-[260px] rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card px-3 py-2 text-[11px] text-slate-400">
        Loading task…
      </div>
    )
  }
  if (!task) {
    return (
      <div className="mt-1 mx-auto max-w-[260px] rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card px-3 py-2 text-[11px] text-slate-400 flex items-center gap-1.5">
        <AlertCircle className="w-3 h-3" />
        Task unavailable
      </div>
    )
  }

  const priority = getPriority(task)
  const assignee = task.assignee

  return (
    <Link
      to={`/my-tasks?task=${task.id}`}
      className="mt-1 mx-auto block max-w-[260px] text-left rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card hover:border-brand-300 dark:hover:border-brand-500/40 hover:shadow-md transition-all relative overflow-hidden"
    >
      <span className={`absolute left-0 top-2 bottom-2 w-1 rounded-full ${PRIORITY_BAR[priority] || PRIORITY_BAR.none}`} />
      <div className="pl-3 pr-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mb-0.5">{task.task_id}</div>
            <div className="text-[13px] font-semibold text-slate-900 dark:text-white leading-snug line-clamp-2">{task.title}</div>
          </div>
          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${URGENCY_STYLES[task.urgency] || 'bg-slate-100 text-slate-500'}`}>
            {task.urgency}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5 min-w-0">
            {assignee && (
              assignee.avatar_url
                ? <img src={assignee.avatar_url} className="w-4 h-4 rounded-full" alt="" title={assignee.full_name} />
                : <span className="w-4 h-4 rounded-full bg-brand-500 text-white text-[9px] font-bold flex items-center justify-center" title={assignee.full_name}>
                    {assignee.full_name?.[0] || '?'}
                  </span>
            )}
            <span className="truncate">{assignee?.full_name || 'Unassigned'}</span>
          </div>
          {task.due_date && (
            <span className="flex items-center gap-1 shrink-0">
              <Calendar className="w-3 h-3" />
              {formatDateShort(task.due_date)}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
