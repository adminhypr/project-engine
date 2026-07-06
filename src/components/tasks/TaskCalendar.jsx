import { useEffect, useMemo, useRef, useState } from 'react'
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
import { ChevronLeft, ChevronRight, CalendarX2, SlidersHorizontal, Check } from 'lucide-react'
import { monthMatrix, bucketTasksByDay, addMonths, formatMonthTitle, dueDateForDay, dueDayIso } from '../../lib/calendar'
import { CALENDAR_PROPS, loadCalendarProps, saveCalendarProps } from '../../lib/calendarProps'

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

// Close a popover on outside mousedown or Escape (same idiom as
// ReactionPicker). Listener only attached while open.
function useCloseOnOutside(open, onClose) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  return ref
}

const STATUS_BADGE = {
  'Not Started': 'bg-slate-100 text-slate-500 dark:bg-dark-hover dark:text-slate-400',
  'In Progress': 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
  'Blocked':     'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  'Done':        'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300',
}
const URGENCY_BADGE = {
  Urgent: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  High:   'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  Med:    'bg-slate-100 text-slate-500 dark:bg-dark-hover dark:text-slate-400',
  Low:    'bg-slate-100 text-slate-400 dark:bg-dark-hover dark:text-slate-500',
}

function dueTimeLabel(due) {
  if (!due || !/T|\s\d{2}:/.test(String(due))) return null
  const d = new Date(due)
  if (isNaN(d.getTime())) return null
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// Notion-style property rows under the pill title ("Property visibility").
function PillProps({ task, visibleProps }) {
  if (!visibleProps?.length) return null
  const time = visibleProps.includes('due_time') ? dueTimeLabel(task.due_date) : null
  return (
    <span className="flex flex-wrap items-center gap-1 pl-3">
      {visibleProps.includes('status') && task.status && (
        <span className={`px-1.5 py-px rounded text-[9px] font-semibold ${STATUS_BADGE[task.status] || STATUS_BADGE['Not Started']}`}>
          {task.status}
        </span>
      )}
      {visibleProps.includes('urgency') && task.urgency && (
        <span className={`px-1.5 py-px rounded text-[9px] font-semibold ${URGENCY_BADGE[task.urgency] || URGENCY_BADGE.Med}`}>
          {task.urgency}
        </span>
      )}
      {visibleProps.includes('assignee') && task.assignee?.full_name && (
        <span className="inline-flex items-center gap-1 text-[9px] text-slate-500 dark:text-slate-400 min-w-0">
          {task.assignee.avatar_url
            ? <img src={task.assignee.avatar_url} className="w-3 h-3 rounded-full" alt="" />
            : <span className="w-3 h-3 rounded-full bg-brand-500 text-white text-[7px] font-bold flex items-center justify-center">{task.assignee.full_name[0]}</span>}
          <span className="truncate max-w-[90px]">{task.assignee.full_name}</span>
        </span>
      )}
      {visibleProps.includes('team') && task.team?.name && (
        <span className="text-[9px] text-slate-400 dark:text-slate-500 truncate max-w-[90px]">{task.team.name}</span>
      )}
      {visibleProps.includes('task_id') && task.task_id && (
        <span className="text-[9px] font-mono text-slate-400 dark:text-slate-500">{task.task_id}</span>
      )}
      {time && <span className="text-[9px] text-slate-400 dark:text-slate-500">{time}</span>}
    </span>
  )
}

function Pill({ task, onOpen, overlay = false, visibleProps = [] }) {
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
      className={`w-full flex flex-col items-start gap-0.5 px-1.5 py-1 rounded-md text-left text-[11px] font-medium
        bg-white dark:bg-dark-card border border-slate-200/70 dark:border-dark-border
        text-slate-700 dark:text-slate-200 shadow-soft dark:shadow-none
        hover:border-brand-300 dark:hover:border-brand-500/40 transition-colors
        ${isDragging ? 'opacity-30' : ''}
        ${overlay ? 'shadow-elevated rotate-2 cursor-grabbing' : 'cursor-grab'}
        ${task.status === 'Done' ? 'opacity-55 line-through decoration-slate-400' : ''}`}
    >
      <span className="flex items-center gap-1.5 w-full min-w-0">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT[task.priority] || 'bg-slate-300'}`} />
        <span className="truncate">{task.title}</span>
      </span>
      <PillProps task={task} visibleProps={visibleProps} />
    </button>
  )
}

function DayCell({ cell, tasks, expanded, onToggleExpand, onOpenTask, visibleProps }) {
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
      {visible.map(t => <Pill key={t.id} task={t} onOpen={onOpenTask} visibleProps={visibleProps} />)}
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

function NoDateTray({ undated, open, onToggle, onClose, onOpenTask, visibleProps }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'no-date-tray' })
  const rootRef = useCloseOnOutside(open, onClose)
  return (
    <div className="relative" ref={rootRef}>
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
            undated.map(t => <Pill key={t.id} task={t} onOpen={onOpenTask} visibleProps={visibleProps} />)
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
  const [propsOpen, setPropsOpen] = useState(false)
  const propsPopoverRef = useCloseOnOutside(propsOpen, () => setPropsOpen(false))
  const [visibleProps, setVisibleProps] = useState(() => loadCalendarProps())

  function toggleProp(key) {
    setVisibleProps(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
      saveCalendarProps(next)
      return next
    })
  }
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
    // No-op when dropped back on its own LOCAL day
    if (iso === dueDayIso(task.due_date)) return
    // Keep the task's local time-of-day — due_date is timestamptz and due
    // times feed the reminder emails. Tray drops default to 17:00 local.
    onReschedule(task.id, dueDateForDay(task.due_date, iso))
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
          <div className="ml-auto flex items-center gap-2">
            <div className="relative" ref={propsPopoverRef}>
              <button
                onClick={() => setPropsOpen(o => !o)}
                className={`btn text-xs px-2.5 py-1.5 inline-flex items-center gap-1.5 ${visibleProps.length ? 'text-brand-600 dark:text-brand-400' : ''}`}
                title="Choose which properties show on cards"
              >
                <SlidersHorizontal size={13} />
                Display
                {visibleProps.length > 0 && (
                  <span className="text-[10px] font-semibold bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300 rounded-full px-1.5">
                    {visibleProps.length}
                  </span>
                )}
              </button>
              {propsOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-30 w-48 rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-panel p-1.5">
                  <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Properties on cards
                  </p>
                  {CALENDAR_PROPS.map(p => {
                    const on = visibleProps.includes(p.key)
                    return (
                      <button
                        key={p.key}
                        onClick={() => toggleProp(p.key)}
                        className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors"
                        role="menuitemcheckbox"
                        aria-checked={on}
                      >
                        {p.label}
                        {on && <Check size={13} className="text-brand-500" />}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <NoDateTray undated={undated} open={trayOpen} onToggle={() => setTrayOpen(o => !o)} onClose={() => setTrayOpen(false)} onOpenTask={onOpenTask} visibleProps={visibleProps} />
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
              visibleProps={visibleProps}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeTask && <div className="w-44"><Pill task={activeTask} overlay visibleProps={visibleProps} /></div>}
      </DragOverlay>
    </DndContext>
  )
}
