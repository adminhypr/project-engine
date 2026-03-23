import { motion } from 'framer-motion'
import { PRIORITY_COLORS } from '../../lib/priority'
import { formatDateShort } from '../../lib/helpers'
import { PriorityBadge, UrgencyBadge, StatusBadge } from '../ui'
import { MessageSquare, Check, X, Calendar, Clock, User, ChevronRight } from 'lucide-react'
import { TaskIcon } from '../ui/TaskIconPicker'

const PRIORITY_INDICATOR = {
  red:    'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-400',
  green:  'bg-emerald-500',
  none:   'bg-slate-300 dark:bg-slate-600',
}

export default function TaskTable({
  tasks, onRowClick, showAssignedTo = false, showAssignedBy = true,
  onAccept, onDecline, showAcceptanceActions = false
}) {
  if (!tasks.length) return (
    <div className="text-center py-16 text-slate-400 dark:text-slate-500 text-sm">No tasks match your filters.</div>
  )

  return (
    <div className="space-y-2">
      {tasks.map((task, i) => {
        const isPending = task.acceptance_status === 'Pending'
        const isDeclined = task.acceptance_status === 'Declined'

        return (
          <motion.div
            key={task.id}
            onClick={() => onRowClick?.(task)}
            className={`group relative cursor-pointer rounded-xl border transition-all duration-150
              ${isPending
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

            <div className="flex items-center gap-4 px-5 pl-6 py-3.5">
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
                  {isPending && <span className="shrink-0 badge bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 text-[10px]">Pending</span>}
                  {isDeclined && <span className="shrink-0 badge bg-red-500/15 text-red-700 dark:text-red-400 text-[10px]">Declined</span>}
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
