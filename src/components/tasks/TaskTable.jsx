import { motion } from 'framer-motion'
import { PRIORITY_COLORS } from '../../lib/priority'
import { formatDateShort } from '../../lib/helpers'
import { PriorityBadge, UrgencyBadge, StatusBadge } from '../ui'
import { MessageSquare, MessagesSquare, Check, X, Calendar, Clock, User, ChevronRight, GitBranch } from 'lucide-react'
import { TaskIcon } from '../ui/TaskIconPicker'
import { completionProgress } from '../../lib/perAssigneeCompletion'
import { truncateParentLabel } from '../../lib/subtasks'

const PRIORITY_INDICATOR = {
  red:    'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-400',
  green:  'bg-emerald-500',
  none:   'bg-slate-300 dark:bg-slate-600',
}

export default function TaskTable({
  tasks, onRowClick, showAssignedTo = false, showAssignedBy = true,
  onAccept, onDecline, showAcceptanceActions = false,
  selectable = false, selectedIds, onSelectionChange
}) {
  if (!tasks.length) return (
    <div className="text-center py-16 text-slate-400 dark:text-slate-500 text-sm">No tasks match your filters.</div>
  )

  // Lookup map for parent titles when a row is a sub-task and the parent
  // happens to be in the same list. (When the parent isn't in the visible
  // slice, we just show the generic "↳ parent" pill without title.)
  const titleById = new Map(tasks.map(t => [t.id, t.title]))

  return (
    <div className="space-y-2">
      {tasks.map((task, i) => {
        const isPending = task.acceptance_status === 'Pending'
        const isDeclined = task.acceptance_status === 'Declined'
        const isSelected = selectable && selectedIds?.has(task.id)
        const progress = completionProgress(task.task_assignees ?? task.assignees)
        const showProgressChip = progress.total >= 2
        const progressComplete = progress.done === progress.total

        return (
          <motion.div
            key={task.id}
            onClick={() => onRowClick?.(task)}
            className={`group relative cursor-pointer rounded-xl border transition-all duration-150
              ${isSelected
                ? 'border-brand-300 bg-brand-50/30 dark:border-brand-500/30 dark:bg-brand-500/5'
                : isPending
                  ? 'border-yellow-300 bg-yellow-50/50 dark:border-yellow-500/30 dark:bg-yellow-500/5'
                  : isDeclined
                    ? 'border-red-200 bg-red-50/30 opacity-60 dark:border-red-500/20 dark:bg-red-500/5'
                    : 'border-slate-200/70 bg-white hover:border-slate-300 hover:shadow-md dark:border-dark-border dark:bg-dark-card dark:hover:border-slate-600 dark:hover:shadow-lg dark:hover:shadow-black/10'
              }`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.03 }}
          >
            {/* Priority indicator bar */}
            <div className={`absolute left-0 top-3 bottom-3 w-1 rounded-full ${PRIORITY_INDICATOR[task.priority] || PRIORITY_INDICATOR.none}`} />

            <div className={`flex items-center gap-4 px-5 ${selectable ? 'pl-5' : 'pl-6'} py-3.5`}>
              {/* Selection checkbox */}
              {selectable && (
                <div className="shrink-0 flex items-center" onClick={e => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={e => onSelectionChange?.(task.id, e.target.checked)}
                    className="rounded border-slate-300 dark:border-dark-border text-brand-500 focus:ring-brand-500"
                  />
                </div>
              )}
              {/* Task icon */}
              {task.icon && (
                <div className="shrink-0 w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-500/10 flex items-center justify-center">
                  <TaskIcon name={task.icon} size={18} className="text-brand-500 dark:text-brand-400" />
                </div>
              )}

              {/* Main content */}
              <div className="flex-1 min-w-0">
                {/* Top row: title + badges */}
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold text-slate-900 dark:text-white text-sm truncate">{task.title}</h3>
                  {task.parent_task_id && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        window.dispatchEvent(new CustomEvent('open-task', { detail: { taskId: task.parent_task_id } }))
                      }}
                      className="shrink-0 badge bg-slate-100 hover:bg-slate-200 text-slate-600 dark:bg-dark-hover dark:text-slate-300 text-[10px] inline-flex items-center transition-colors"
                      title={`Parent: ${titleById.get(task.parent_task_id) || 'Open parent'}`}
                      aria-label="Open parent task"
                    >
                      ↳ {truncateParentLabel(titleById.get(task.parent_task_id) || 'parent', 20)}
                    </button>
                  )}
                  {task.subtask_count > 0 && (
                    <span
                      className="shrink-0 badge bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-[10px] inline-flex items-center gap-1"
                      title={`${task.open_subtask_count} of ${task.subtask_count} sub-task${task.subtask_count === 1 ? '' : 's'} open`}
                    >
                      <GitBranch size={10} aria-hidden="true" />
                      {task.subtask_count - task.open_subtask_count}/{task.subtask_count}
                    </span>
                  )}
                  {isPending && <span className="shrink-0 badge bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 text-[10px]">Pending</span>}
                  {isDeclined && <span className="shrink-0 badge bg-red-500/15 text-red-700 dark:text-red-400 text-[10px]">Declined</span>}
                  {showProgressChip && (
                    <span
                      className={`shrink-0 badge text-[10px] ${
                        progressComplete
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
                      }`}
                      title={`${progress.done} of ${progress.total} assignees completed`}
                    >
                      {progress.done}/{progress.total}
                    </span>
                  )}
                  {task.unread_chat_count > 0 && (
                    <span
                      className="shrink-0 inline-flex items-center gap-0.5 text-indigo-500 dark:text-indigo-400"
                      title={`${task.unread_chat_count} unread chat message${task.unread_chat_count === 1 ? '' : 's'}`}
                      role="img"
                      aria-label={`${task.unread_chat_count} unread chat message${task.unread_chat_count === 1 ? '' : 's'}`}
                    >
                      <MessagesSquare size={12} aria-hidden="true" />
                      <span className="sr-only">{`${task.unread_chat_count} unread chat message${task.unread_chat_count === 1 ? '' : 's'}`}</span>
                    </span>
                  )}
                </div>

                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  {task.who_due_to && (
                    <span>For: <span className="text-slate-700 dark:text-slate-300">{task.who_due_to}</span></span>
                  )}
                  {showAssignedBy && task.assigner?.full_name && (
                    <span className="flex items-center gap-1">
                      <User size={11} className="text-slate-400 dark:text-slate-500" />
                      {task.assigner.full_name}
                    </span>
                  )}
                  {showAssignedTo && task.assignee?.full_name && (
                    <span className="flex items-center gap-1">
                      <User size={11} className="text-slate-400 dark:text-slate-500" />
                      {task.assignee.full_name}
                      {task.assignees?.length > 1 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">
                          +{task.assignees.length - 1}
                        </span>
                      )}
                      {task.team?.name && <span className="text-slate-400 dark:text-slate-600">· {task.team.name}</span>}
                    </span>
                  )}
                  {task.due_date && (
                    <span className="flex items-center gap-1">
                      <Calendar size={11} className="text-slate-400 dark:text-slate-500" />
                      {formatDateShort(task.due_date)}
                    </span>
                  )}
                  {task.comment_count > 0 && (
                    <span className="flex items-center gap-1 text-slate-400 dark:text-slate-500">
                      <MessageSquare size={11} />
                      {task.comment_count}
                    </span>
                  )}
                </div>
              </div>

              {/* Right side: badges + actions */}
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                <PriorityBadge priority={task.priority} />
                <UrgencyBadge urgency={task.urgency} />
                <StatusBadge status={task.status} />
              </div>

              {/* Mobile badges */}
              <div className="flex sm:hidden items-center gap-1.5 shrink-0">
                <PriorityBadge priority={task.priority} />
                <StatusBadge status={task.status} />
              </div>

              {/* Acceptance actions */}
              {showAcceptanceActions && isPending && (
                <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <motion.button
                    onClick={() => onAccept?.(task)}
                    className="p-2 rounded-lg bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-400 transition-colors"
                    whileTap={{ scale: 0.9 }}
                    title="Accept"
                  >
                    <Check size={14} />
                  </motion.button>
                  <motion.button
                    onClick={() => onDecline?.(task)}
                    className="p-2 rounded-lg bg-red-500/15 text-red-700 hover:bg-red-500/25 dark:text-red-400 transition-colors"
                    whileTap={{ scale: 0.9 }}
                    title="Decline"
                  >
                    <X size={14} />
                  </motion.button>
                </div>
              )}

              {/* Chevron hint */}
              <ChevronRight size={16} className="text-slate-300 dark:text-slate-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block" />
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
