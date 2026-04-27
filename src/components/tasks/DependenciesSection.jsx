import { useState, useMemo, useRef, useEffect } from 'react'
import { Plus, X, Ban, ArrowRight } from 'lucide-react'
import { useTaskDependencies } from '../../hooks/useTaskDependencies'
import { StatusBadge, showToast } from '../ui'
import { buildExcludedPickerIds } from '../../lib/dependencies'
import { truncateParentLabel } from '../../lib/subtasks'

// Typeahead picker over readable, non-Done, non-self, non-already-linked tasks.
function DependencyPicker({ taskId, tasks = [], existingBlockerIds, onPick, onCancel }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const exclude = useMemo(() => buildExcludedPickerIds({
    selfId: taskId,
    existingBlockerIds,
    allTasks: tasks,
  }), [taskId, existingBlockerIds, tasks])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tasks
      .filter(t => !exclude.has(t.id))
      .filter(t => !q
        || (t.title || '').toLowerCase().includes(q)
        || (t.task_id || '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [query, tasks, exclude])

  return (
    <div className="rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-soft p-3 space-y-2">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search tasks to add as a blocker…"
        className="form-input w-full text-sm"
      />
      {results.length === 0 ? (
        <p className="text-xs text-slate-400 italic px-1">
          {tasks.length === 0 ? 'Loading tasks…' : 'No matching open tasks.'}
        </p>
      ) : (
        <ul className="max-h-56 overflow-y-auto -mx-1">
          {results.map(t => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onPick(t)}
                className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-dark-hover flex items-center gap-2"
              >
                <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                  {t.title}
                </span>
                <StatusBadge status={t.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end pt-1">
        <button type="button" onClick={onCancel} className="btn text-xs">Close</button>
      </div>
    </div>
  )
}

// Renders a single blocker chip — title + status + remove X. Click jumps
// to the linked task.
function DependencyChip({ task, onOpen, onRemove, removable }) {
  if (!task) {
    return (
      <span className="badge bg-slate-100 dark:bg-dark-hover text-slate-400 dark:text-slate-500 text-[10px]">
        (hidden)
      </span>
    )
  }
  const isDone = task.status === 'Done'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full pl-2 pr-1 py-0.5 text-[11px] border transition-colors ${
      isDone
        ? 'border-emerald-200/60 bg-emerald-50/50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/5 dark:text-emerald-400'
        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 dark:border-dark-border dark:bg-dark-card dark:text-slate-300 dark:hover:border-slate-600'
    }`}>
      <button
        type="button"
        onClick={() => onOpen?.(task)}
        className="font-medium hover:underline truncate max-w-[160px]"
        title={task.title}
      >
        {truncateParentLabel(task.title, 22)}
      </button>
      <span className="text-[9px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {task.status}
      </span>
      {removable && (
        <button
          type="button"
          onClick={() => onRemove?.(task)}
          className="text-slate-300 hover:text-red-500 dark:text-slate-600 dark:hover:text-red-400 p-0.5 rounded transition-colors"
          aria-label={`Remove ${task.title}`}
        >
          <X size={11} />
        </button>
      )}
    </span>
  )
}

export default function DependenciesSection({ task, tasks = [] }) {
  const { blockers, blocked, addBlocker, removeBlocker } = useTaskDependencies(task?.id)
  const [showPicker, setShowPicker] = useState(false)

  const taskById = useMemo(
    () => new Map((tasks || []).map(t => [t.id, t])),
    [tasks]
  )

  const blockerTasks = useMemo(
    () => blockers.map(r => taskById.get(r.blocker_id)),
    [blockers, taskById]
  )
  const blockedTasks = useMemo(
    () => blocked.map(r => taskById.get(r.blocked_id)),
    [blocked, taskById]
  )

  const existingBlockerIds = useMemo(() => blockers.map(r => r.blocker_id), [blockers])

  const openTask = (t) => {
    if (!t?.id) return
    window.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: t.id } }))
  }

  const handlePick = async (picked) => {
    setShowPicker(false)
    const { error } = await addBlocker(picked.id)
    if (error) {
      showToast(error.message || 'Failed to add blocker', 'error')
      return
    }
    showToast('Blocker added')
  }

  const handleRemove = async (t) => {
    const { error } = await removeBlocker(t.id)
    if (error) {
      showToast(error.message || 'Failed to remove blocker', 'error')
      return
    }
    showToast('Blocker removed')
  }

  if (!task?.id) return null

  return (
    <section className="border-t border-slate-100 dark:border-dark-border px-4 sm:px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Dependencies
        </h3>
        {!showPicker && (
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
          >
            <Plus size={13} /> Add blocker
          </button>
        )}
      </div>

      {showPicker && (
        <DependencyPicker
          taskId={task.id}
          tasks={tasks}
          existingBlockerIds={existingBlockerIds}
          onPick={handlePick}
          onCancel={() => setShowPicker(false)}
        />
      )}

      <div className="space-y-2">
        <div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
            <Ban size={10} aria-hidden="true" />
            Blocked by
          </div>
          {blockerTasks.length === 0 ? (
            <p className="text-xs text-slate-400 italic">No blockers.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {blockerTasks.map((t, i) => (
                <DependencyChip
                  key={blockers[i].blocker_id}
                  task={t}
                  onOpen={openTask}
                  onRemove={handleRemove}
                  removable
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
            <ArrowRight size={10} aria-hidden="true" />
            Blocks
          </div>
          {blockedTasks.length === 0 ? (
            <p className="text-xs text-slate-400 italic">Doesn't block anything.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {blockedTasks.map((t, i) => (
                <DependencyChip
                  key={blocked[i].blocked_id}
                  task={t}
                  onOpen={openTask}
                  removable={false}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
