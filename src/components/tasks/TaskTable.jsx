import { motion } from 'framer-motion'
import { PRIORITY_COLORS } from '../../lib/priority'
import { formatDateShort } from '../../lib/helpers'
import { PriorityBadge, AssignmentBadge, UrgencyBadge, StatusBadge } from '../ui'
import { MessageSquare, Check, X } from 'lucide-react'

export default function TaskTable({
  tasks, onRowClick, showAssignedTo = false, showAssignedBy = true,
  onAccept, onDecline, showAcceptanceActions = false
}) {
  if (!tasks.length) return (
    <div className="text-center py-12 text-slate-400 text-sm">No tasks match your filters.</div>
  )

  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="w-full">
        <thead>
          <tr>
            <th className="table-th">Task</th>
            {showAssignedTo && <th className="table-th hidden sm:table-cell">Assigned To</th>}
            {showAssignedBy && <th className="table-th hidden lg:table-cell">Assigned By</th>}
            <th className="table-th hidden xl:table-cell">Type</th>
            <th className="table-th">Priority</th>
            <th className="table-th hidden md:table-cell">Urgency</th>
            <th className="table-th">Status</th>
            <th className="table-th hidden lg:table-cell">Date Assigned</th>
            <th className="table-th hidden md:table-cell">Due Date</th>
            <th className="table-th w-10 hidden sm:table-cell">💬</th>
            {showAcceptanceActions && <th className="table-th w-24"></th>}
          </tr>
        </thead>
        <tbody>
          {tasks.map((task, i) => {
            const isPending = task.acceptance_status === 'Pending'
            const isDeclined = task.acceptance_status === 'Declined'
            const priorityStyle = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.none
            const rowStyle = isPending
              ? 'bg-yellow-500/8 border-l-4 border-l-yellow-500'
              : isDeclined
                ? 'bg-red-500/5 border-l-4 border-l-red-300 opacity-70'
                : priorityStyle.row

            return (
              <motion.tr
                key={task.id}
                onClick={() => onRowClick?.(task)}
                className={`cursor-pointer transition-all duration-150 ${rowStyle}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: i * 0.02 }}
                whileHover={{ y: -1, boxShadow: '0 4px 20px rgba(26, 39, 68, 0.08)' }}
              >
                <td className="table-td min-w-[140px] sm:min-w-[200px]">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-slate-900 leading-snug">{task.title}</div>
                    {isPending && (
                      <span className="badge bg-yellow-500/15 text-yellow-700 text-[10px]">Pending</span>
                    )}
                    {isDeclined && (
                      <span className="badge bg-red-500/15 text-red-700 text-[10px]">Declined</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {task.task_id}
                    {task.who_due_to && <span> · For: {task.who_due_to}</span>}
                  </div>
                  {/* Show assignee inline on mobile when column is hidden */}
                  {showAssignedTo && (
                    <div className="text-xs text-slate-500 mt-0.5 sm:hidden">
                      → {task.assignee?.full_name}
                    </div>
                  )}
                </td>
                {showAssignedTo && (
                  <td className="table-td hidden sm:table-cell">
                    <div className="text-sm">{task.assignee?.full_name}</div>
                    <div className="text-xs text-slate-400">{task.team?.name}</div>
                  </td>
                )}
                {showAssignedBy && (
                  <td className="table-td hidden lg:table-cell">
                    <div className="text-sm">{task.assigner?.full_name}</div>
                    <div className="text-xs text-slate-400">{task.assigner?.teams?.name}</div>
                  </td>
                )}
                <td className="table-td hidden xl:table-cell">
                  <AssignmentBadge type={task.assignment_type} />
                </td>
                <td className="table-td">
                  <PriorityBadge priority={task.priority} />
                </td>
                <td className="table-td hidden md:table-cell">
                  <UrgencyBadge urgency={task.urgency} />
                </td>
                <td className="table-td">
                  <StatusBadge status={task.status} />
                </td>
                <td className="table-td text-xs text-slate-500 whitespace-nowrap hidden lg:table-cell">
                  {formatDateShort(task.date_assigned)}
                </td>
                <td className="table-td text-xs text-slate-500 whitespace-nowrap hidden md:table-cell">
                  {task.due_date ? formatDateShort(task.due_date) : '—'}
                </td>
                <td className="table-td text-center hidden sm:table-cell">
                  {task.comment_count > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                      <MessageSquare size={12} />
                      {task.comment_count}
                    </span>
                  )}
                </td>
                {showAcceptanceActions && (
                  <td className="table-td">
                    {isPending && (
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <motion.button
                          onClick={() => onAccept?.(task)}
                          className="p-2 sm:p-1.5 rounded-lg bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 transition-colors"
                          whileTap={{ scale: 0.9 }}
                          title="Accept"
                        >
                          <Check size={14} />
                        </motion.button>
                        <motion.button
                          onClick={() => onDecline?.(task)}
                          className="p-2 sm:p-1.5 rounded-lg bg-red-500/15 text-red-700 hover:bg-red-500/25 transition-colors"
                          whileTap={{ scale: 0.9 }}
                          title="Decline"
                        >
                          <X size={14} />
                        </motion.button>
                      </div>
                    )}
                  </td>
                )}
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
