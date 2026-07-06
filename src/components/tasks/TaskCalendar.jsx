import { useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, CalendarX2 } from 'lucide-react'
import { monthMatrix, bucketTasksByDay, addMonths, formatMonthTitle } from '../../lib/calendar'

// Notion-style month calendar (design:
// docs/plans/2026-07-05-calendar-view-design.md). Purely presentational —
// callers pass the SAME filtered task list their list/kanban views use.
//
//   tasks         enriched tasks ({ id, title, due_date, priority, status })
//   onOpenTask    (task) => void — open the detail panel ("side peek")
//   onReschedule  (taskId, isoDateOrNull) => void|Promise — due-date write;
//                 null = clear (drop on the No-due-date tray)
//
// Deliberately NO AnimatePresence popLayout / layoutId here — dnd-kit and
// framer re-parenting fighting over nodes is the 2026-07-05 removeChild
// crash class.

const DOT = {
  red:    'bg-red-500',
  orange: 'bg-orange-500',
  yellow: 'bg-yellow-500',
  green:  'bg-emerald-500',
}

const MAX_VISIBLE = 3

function Pill({ task, onOpen, overlay = false }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    disabled: overlay,
  })
  return (
    <button
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : { ...listeners, ...attributes })}
      onClick={() => !overlay && onOpen?.(task)}
      title={task.title}
      className={`w-full flex items-center gap-1.5 px-1.5 py-1 rounded-md text-left text-[11px] font-medium
        bg-white dark:bg-dark-card border border-slate-200/70 dark:border-dark-border
        text-slate-700 dark:text-slate-200 shadow-soft dark:shadow-none
        hover:border-brand-300 dark:hover:border-brand-500/40 transition-colors
        ${isDragging ? 'opacity-30' : ''}
        ${overlay ? 'shadow-elevated rotate-2 cursor-grabbing' : 'cursor-grab'}
        ${task.status === 'Done' ? 'opacity-55 line-through decoration-slate-400' : ''}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[task.priority] || 'bg-slate-300'}`} />
      <span className="truncate">{task.title}</span>
    </button>
  )
}

function DayCell({ cell, tasks, expanded, onToggleExpand, onOpenTask }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day-${cell.iso}` })
  const visible = expanded ? tasks : tasks.slice(0, MAX_VISIBLE)
  const hidden = tasks.length - visible.length
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[104px] p-1.5 border-t border-l border-slate-100 dark:border-dark-border flex flex-col gap-1
        ${cell.inMonth ? 'bg-white dark:bg-dark-surface' : 'bg-slate-50/60 dark:bg-dark-bg/40'}
        ${isOver ? 'ring-2 ring-inset ring-brand-400 bg-brand-50/40 dark:bg-brand-500/10' : ''}`}
    >
      <span
        className={`self-end text-[11px] leading-none px-1.5 py-1 rounded-full font-medium
          ${cell.isToday
            ? 'bg-brand-500 text-white'
            : cell.inMonth
              ? 'text-slate-500 dark:text-slate-400'
              : 'text-slate-300 dark:text-slate-600'}`}
      >
        {cell.dayOfMonth}
      </span>
      {visible.map(t => <Pill key={t.id} task={t} onOpen={onOpenTask} />)}
      {hidden > 0 && (
        <button
          onClick={() => onToggleExpand(cell.iso)}
          className="text-[10px] text-slate-400 hover:text-brand-500 dark:text-slate-500 dark:hover:text-brand-400 text-left px-1.5 transition-colors"
        >
          +{hidden} more
        </button>
      )}
      {expanded && tasks.length > MAX_VISIBLE && (
        <button
          onClick={() => onToggleExpand(cell.iso)}
          className="text-[10px] text-slate-400 hover:text-brand-500 dark:text-slate-500 dark:hover:text-brand-400 text-left px-1.5 transition-colors"
        >
          Show less
        </button>
      )}
    </div>
  )
}

function NoDateTray({ undated, open, onToggle, onOpenTask }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'no-date-tray' })
  return (
    <div className="relative">
      <button
        ref={setNodeRef}
        onClick={onToggle}
        className={`btn text-xs px-2.5 py-1.5 inline-flex items-center gap-1.5
          ${isOver ? 'ring-2 ring-brand-400' : ''}`}
        title="Tasks without a due date — drag one onto a day to schedule it, or drop a pill here to clear its date"
      >
        <CalendarX2 size={13} />
        No due date ({undated.length})
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-64 max-h-80 overflow-y-auto rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-panel p-2 space-y-1">
          {undated.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic px-1 py-2">
              Every task has a due date.
            </p>
          ) : (
            undated.map(t => <Pill key={t.id} task={t} onOpen={onOpenTask} />)
          )}
        </div>
      )}
    </div>
  )
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function TaskCalendar({ tasks, onOpenTask, onReschedule }) {
  const today = new Date()
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [trayOpen, setTrayOpen] = useState(false)
  const [expandedDays, setExpandedDays] = useState(() => new Set())
  const [activeTask, setActiveTask] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const weeks = useMemo(() => monthMatrix(cursor.year, cursor.month), [cursor])
  const { byDay, undated } = useMemo(() => bucketTasksByDay(tasks), [tasks])

  function toggleExpand(iso) {
    setExpandedDays(prev => {
      const next = new Set(prev)
      if (next.has(iso)) next.delete(iso); else next.add(iso)
      return next
    })
  }

  function move(delta) {
    setCursor(c => addMonths(c.year, c.month, delta))
    setExpandedDays(new Set())
  }

  function handleDragEnd({ active, over }) {
    setActiveTask(null)
    if (!over) return
    const task = active.data.current?.task
    if (!task) return
    if (over.id === 'no-date-tray') {
      if (task.due_date) onReschedule(task.id, null)
      return
    }
    const iso = String(over.id).startsWith('day-') ? String(over.id).slice(4) : null
    if (!iso) return
    // No-op when dropped back on its own day
    const current = (task.due_date || '').slice(0, 10)
    if (iso === current) return
    onReschedule(task.id, iso)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setActiveTask(active.data.current?.task || null)}
      onDragCancel={() => setActiveTask(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="card p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-dark-border flex-wrap">
          <button onClick={() => move(-1)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-dark-hover dark:hover:text-slate-200 transition-colors" aria-label="Previous month">
            <ChevronLeft size={16} />
          </button>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white min-w-[8.5rem] text-center">
            {formatMonthTitle(cursor.year, cursor.month)}
          </h3>
          <button onClick={() => move(1)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-dark-hover dark:hover:text-slate-200 transition-colors" aria-label="Next month">
            <ChevronRight size={16} />
          </button>
          <button
            onClick={() => { setCursor({ year: today.getFullYear(), month: today.getMonth() }); setExpandedDays(new Set()) }}
            className="btn text-xs px-2.5 py-1.5"
          >
            Today
          </button>
          <div className="ml-auto">
            <NoDateTray undated={undated} open={trayOpen} onToggle={() => setTrayOpen(o => !o)} onOpenTask={onOpenTask} />
          </div>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 border-l-0">
          {WEEKDAYS.map(d => (
            <div key={d} className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 text-right border-l border-slate-100 dark:border-dark-border first:border-l-0">
              {d}
            </div>
          ))}
        </div>

        {/* Month grid */}
        <div className="grid grid-cols-7 [&>div:nth-child(7n+1)]:border-l-0">
          {weeks.flat().map(cell => (
            <DayCell
              key={cell.iso}
              cell={cell}
              tasks={byDay.get(cell.iso) || []}
              expanded={expandedDays.has(cell.iso)}
              onToggleExpand={toggleExpand}
              onOpenTask={onOpenTask}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask && <div className="w-44"><Pill task={activeTask} overlay /></div>}
      </DragOverlay>
    </DndContext>
  )
}
