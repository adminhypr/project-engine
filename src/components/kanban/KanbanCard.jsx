import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { formatDateShort } from '../../lib/helpers'
import { showToast } from '../ui'
import CardActionMenu from './CardActionMenu'
import { Calendar, MessageSquare, GripVertical } from 'lucide-react'

const PRIORITY_INDICATOR = {
  red:    'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-400',
  green:  'bg-emerald-500',
  none:   'bg-slate-300 dark:bg-slate-600',
}

const URGENCY_CYCLE = { High: 'Med', Med: 'Low', Low: 'High' }
const URGENCY_STYLES = {
  High: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  Med:  'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400',
  Low:  'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
}

export default function KanbanCard({ task, onClick, isDragOverlay = false, onUpdateTask, onDeleteTask, onRefetch }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { type: 'task', task } })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const [editingDueDate, setEditingDueDate] = useState(false)

  const assignees = task.assignees?.length > 0 ? task.assignees : task.assignee ? [task.assignee] : []
  const visibleAssignees = assignees.slice(0, 3)
  const overflow = assignees.length - 3

  async function handleUrgencyCycle(e) {
    e.stopPropagation()
    if (!onUpdateTask) return
    const next = URGENCY_CYCLE[task.urgency] || 'Med'
    const result = await onUpdateTask(task.id, { urgency: next })
    if (result.ok) { showToast(`Urgency → ${next}`); onRefetch?.() }
    else showToast(result.msg || 'Failed', 'error')
  }

  async function handleDueDateChange(e) {
    const val = e.target.value
    setEditingDueDate(false)
    if (!val || !onUpdateTask) return
    const result = await onUpdateTask(task.id, { due_date: new Date(val).toISOString() })
    if (result.ok) { showToast('Due date updated'); onRefetch?.() }
    else showToast(result.msg || 'Failed', 'error')
  }

  // Get today's date string for min attribute
  const today = new Date().toISOString().split('T')[0]

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative rounded-xl border transition-all duration-150 cursor-grab active:cursor-grabbing
        ${isDragOverlay
          ? 'shadow-elevated scale-[1.02] border-brand-300 dark:border-brand-500/40 bg-white dark:bg-dark-card'
          : isDragging
            ? 'opacity-40 border-slate-200/70 bg-white dark:border-dark-border dark:bg-dark-card'
            : 'border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:shadow-md dark:border-dark-border dark:bg-dark-card dark:shadow-none dark:hover:border-slate-600'
        }`}
      onClick={() => !isDragging && onClick?.(task)}
      {...attributes}
      {...listeners}
    >
      {/* Priority indicator bar */}
      <div className={`absolute left-0 top-2.5 bottom-2.5 w-1 rounded-full ${PRIORITY_INDICATOR[task.priority] || PRIORITY_INDICATOR.none}`} />

      <div className="pl-5 pr-3 py-3">
        {/* Title row */}
        <div className="flex items-start gap-1 mb-2">
          <h4 className="font-semibold text-slate-900 dark:text-white text-sm leading-snug line-clamp-2 flex-1">
            {task.title}
          </h4>

          {/* Action menu (hover only, not on drag overlay) */}
          {!isDragOverlay && onUpdateTask && (
            <CardActionMenu
              task={task}
              onUpdateTask={onUpdateTask}
              onDeleteTask={onDeleteTask}
              onRefetch={onRefetch}
            />
          )}

          <GripVertical size={14} className="text-slate-300 dark:text-slate-600 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {/* Meta row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Assignee avatars */}
            {visibleAssignees.length > 0 && (
              <div className="flex -space-x-1.5">
                {visibleAssignees.map((a, i) => (
                  a.avatar_url
                    ? <img key={a.id || i} src={a.avatar_url} className="w-5 h-5 rounded-full ring-1 ring-white dark:ring-dark-card" alt="" title={a.full_name} />
                    : <div key={a.id || i} className="w-5 h-5 rounded-full bg-brand-500 ring-1 ring-white dark:ring-dark-card flex items-center justify-center text-white text-[9px] font-bold" title={a.full_name}>
                        {a.full_name?.[0] || '?'}
                      </div>
                ))}
                {overflow > 0 && (
                  <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-dark-border ring-1 ring-white dark:ring-dark-card flex items-center justify-center text-[9px] font-semibold text-slate-500 dark:text-slate-400">
                    +{overflow}
                  </div>
                )}
              </div>
            )}

            {/* Due date — inline editable */}
            {editingDueDate ? (
              <input
                type="date"
                min={today}
                defaultValue={task.due_date ? new Date(task.due_date).toISOString().split('T')[0] : ''}
                onChange={handleDueDateChange}
                onBlur={() => setEditingDueDate(false)}
                onClick={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
                className="form-input text-[11px] py-0 px-1 w-28"
                autoFocus
              />
            ) : task.due_date ? (
              <span
                className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 truncate cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                onClick={e => { e.stopPropagation(); if (onUpdateTask) setEditingDueDate(true) }}
                onPointerDown={e => { if (onUpdateTask) e.stopPropagation() }}
                title="Click to edit due date"
              >
                <Calendar size={10} className="shrink-0" />
                {formatDateShort(task.due_date)}
              </span>
            ) : onUpdateTask ? (
              <span
                className="flex items-center gap-1 text-[11px] text-slate-300 dark:text-slate-600 cursor-pointer hover:text-slate-500 dark:hover:text-slate-400 transition-colors"
                onClick={e => { e.stopPropagation(); setEditingDueDate(true) }}
                onPointerDown={e => e.stopPropagation()}
                title="Set due date"
              >
                <Calendar size={10} />
              </span>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* Comment count */}
            {task.comment_count > 0 && (
              <span className="flex items-center gap-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                <MessageSquare size={10} />
                {task.comment_count}
              </span>
            )}

            {/* Urgency badge — click to cycle */}
            <button
              onClick={onUpdateTask ? handleUrgencyCycle : undefined}
              onPointerDown={e => { if (onUpdateTask) e.stopPropagation() }}
              className={`badge text-[10px] ${URGENCY_STYLES[task.urgency] || 'bg-slate-100 text-slate-500'} ${onUpdateTask ? 'cursor-pointer hover:ring-1 hover:ring-slate-300 dark:hover:ring-slate-600' : ''}`}
              title={onUpdateTask ? 'Click to change urgency' : task.urgency}
            >
              {task.urgency}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
