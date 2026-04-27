import { useState } from 'react'
import { Plus, ChevronRight, X } from 'lucide-react'
import { useSubtasks } from '../../hooks/useSubtasks'
import { useAuth } from '../../hooks/useAuth'
import { useProfiles } from '../../hooks/useTasks'
import { UrgencyBadge, StatusBadge, showToast } from '../ui'
import { completionProgress } from '../../lib/perAssigneeCompletion'

// Inline mini-form for adding a sub-task. Empty assignee by default — user
// must pick (matches David's call: silent inheritance is a footgun).
function SubtaskForm({ parentTask, tasks, onCreated, onCancel }) {
  const { profiles: allProfiles } = useProfiles({ excludeExternals: true })
  const [title, setTitle]         = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [urgency, setUrgency]     = useState('Med')
  const [dueDate, setDueDate]     = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { createSubtask } = useSubtasks(parentTask?.id, tasks)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) {
      showToast('Title required', 'error')
      return
    }
    if (!assigneeId) {
      showToast('Pick an assignee', 'error')
      return
    }
    setSubmitting(true)
    const result = await createSubtask({
      assigneeIds: [assigneeId],
      title: title.trim(),
      urgency,
      dueDate: dueDate || null,
      teamId: parentTask?.team_id || null,
      allProfiles,
    })
    setSubmitting(false)
    if (!result.ok) {
      showToast(result.msg || 'Failed to create sub-task', 'error')
      return
    }
    showToast('Sub-task added')
    setTitle('')
    setAssigneeId('')
    setUrgency('Med')
    setDueDate('')
    onCreated?.()
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-slate-200 dark:border-dark-border bg-slate-50/40 dark:bg-dark-hover/40 p-3 space-y-2"
    >
      <input
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Sub-task title…"
        className="form-input w-full text-sm"
        autoFocus
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <select
          value={assigneeId}
          onChange={e => setAssigneeId(e.target.value)}
          className="form-input text-sm"
          aria-label="Assignee"
        >
          <option value="">Pick assignee…</option>
          {allProfiles.map(p => (
            <option key={p.id} value={p.id}>{p.full_name}</option>
          ))}
        </select>
        <select
          value={urgency}
          onChange={e => setUrgency(e.target.value)}
          className="form-input text-sm"
          aria-label="Urgency"
        >
          <option>Low</option>
          <option>Med</option>
          <option>High</option>
        </select>
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          className="form-input text-sm"
          aria-label="Due date (optional)"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn text-xs">Cancel</button>
        <button type="submit" disabled={submitting} className="btn-primary text-xs">
          {submitting ? 'Adding…' : 'Add sub-task'}
        </button>
      </div>
    </form>
  )
}

export default function SubtasksSection({ task, tasks = [], onOpenChild }) {
  const { profile, isAdmin, isExternal } = useAuth()
  const { children } = useSubtasks(task?.id, tasks)
  const [adding, setAdding] = useState(false)

  // v1: only the parent's assigner, an admin, or an assignee on the parent
  // can add sub-tasks. Externals (Agent/Client) are blocked at the UI layer
  // mirroring task creation. RLS will enforce the same on the DB side.
  const isAssigner = task?.assigned_by === profile?.id
  const isOnTask = (task?.task_assignees || []).some(a => a.profile_id === profile?.id)
  const canAdd = !isExternal && (isAdmin || isAssigner || isOnTask)

  // Sub-tasks of sub-tasks aren't allowed (single-level v1) — hide the
  // section entirely when this task is itself a child.
  if (task?.parent_task_id) return null

  return (
    <section className="border-t border-slate-100 dark:border-dark-border px-4 sm:px-5 py-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Sub-tasks{children.length > 0 ? ` (${children.length})` : ''}
        </h3>
        {canAdd && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline flex items-center gap-1"
            aria-label="Add sub-task"
          >
            <Plus size={13} /> Add
          </button>
        )}
      </div>

      {adding && (
        <div className="mb-3">
          <SubtaskForm
            parentTask={task}
            tasks={tasks}
            onCreated={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {children.length === 0 && !adding && (
        <p className="text-sm text-slate-400 italic">No sub-tasks yet.</p>
      )}

      {children.length > 0 && (
        <ul className="space-y-1.5">
          {children.map(child => {
            const progress = completionProgress(child.task_assignees ?? child.assignees)
            const isDone = child.status === 'Done'
            return (
              <li key={child.id}>
                <button
                  type="button"
                  onClick={() => onOpenChild?.(child)}
                  className={`group w-full text-left rounded-lg border px-3 py-2 flex items-center gap-3 transition-colors ${
                    isDone
                      ? 'border-emerald-200/60 bg-emerald-50/40 dark:border-emerald-500/20 dark:bg-emerald-500/5'
                      : 'border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card hover:border-slate-300 dark:hover:border-slate-600'
                  }`}
                >
                  <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${isDone ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                  <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                    {child.title}
                  </span>
                  {progress.total >= 2 && (
                    <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-500/10 text-slate-600 dark:text-slate-300">
                      {progress.done}/{progress.total}
                    </span>
                  )}
                  <UrgencyBadge urgency={child.urgency} />
                  <StatusBadge status={child.status} />
                  <ChevronRight size={14} className="shrink-0 text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
