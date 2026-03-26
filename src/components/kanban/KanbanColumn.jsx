import { useState, useRef, useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { AnimatePresence, motion } from 'framer-motion'
import KanbanCard from './KanbanCard'
import { Plus, ChevronRight } from 'lucide-react'

export const COLUMN_STYLES = {
  'Not Started': { bg: 'bg-slate-500',    border: 'border-t-slate-400',   ring: 'ring-slate-400/30', headerBg: 'bg-slate-100 dark:bg-slate-800/30',     text: 'text-slate-700 dark:text-slate-300' },
  'In Progress': { bg: 'bg-blue-500',     border: 'border-t-blue-500',    ring: 'ring-blue-500/30',  headerBg: 'bg-blue-50/80 dark:bg-blue-500/10',     text: 'text-blue-700 dark:text-blue-300' },
  'Blocked':     { bg: 'bg-red-500',      border: 'border-t-red-500',     ring: 'ring-red-500/30',   headerBg: 'bg-red-50/80 dark:bg-red-500/10',       text: 'text-red-700 dark:text-red-300' },
  'Done':        { bg: 'bg-emerald-500',  border: 'border-t-emerald-500', ring: 'ring-emerald-500/30', headerBg: 'bg-emerald-50/80 dark:bg-emerald-500/10', text: 'text-emerald-700 dark:text-emerald-300' },
}

export default function KanbanColumn({
  status, tasks, onCardClick,
  isCollapsed, onToggleCollapse,
  wipLimit, onSetWipLimit,
  onQuickAdd,
  onUpdateTask, onDeleteTask, onRefetch,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status, disabled: isCollapsed })
  const colStyle = COLUMN_STYLES[status] || COLUMN_STYLES['Not Started']

  const [editingWip, setEditingWip] = useState(false)
  const [wipInput, setWipInput] = useState('')
  const wipRef = useRef(null)

  // Close WIP popover on click outside
  useEffect(() => {
    if (!editingWip) return
    function handler(e) { if (wipRef.current && !wipRef.current.contains(e.target)) setEditingWip(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [editingWip])

  // WIP limit status
  const isOverLimit = wipLimit && tasks.length >= wipLimit
  const isNearLimit = wipLimit && tasks.length >= wipLimit * 0.8 && !isOverLimit

  // Collapsed column
  if (isCollapsed) {
    return (
      <motion.div
        layout
        className="flex flex-col items-center flex-none w-12 cursor-pointer group"
        onClick={onToggleCollapse}
        title={`${status} (${tasks.length})`}
      >
        <div className={`w-full rounded-xl ${colStyle.headerBg} border-t-[3px] ${colStyle.border} py-3 px-1 flex flex-col items-center gap-2 h-full min-h-[200px]`}>
          <ChevronRight size={14} className="text-slate-400 dark:text-slate-500 shrink-0" />
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 dark:bg-dark-border dark:text-slate-400">
            {tasks.length}
          </span>
          <span className={`text-xs font-semibold ${colStyle.text} [writing-mode:vertical-lr] rotate-180`}>
            {status}
          </span>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div layout className="flex flex-col min-w-[260px] md:min-w-0 w-[75vw] md:w-auto flex-1 snap-center md:snap-align-none">
      {/* Column header */}
      <div className={`flex items-center gap-2 px-3 py-2.5 mb-2 rounded-xl border-t-[3px] ${colStyle.border} ${colStyle.headerBg}
        ${isOverLimit ? 'ring-1 ring-red-300 dark:ring-red-500/40' : ''}`}>
        <button
          onClick={onToggleCollapse}
          className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
          title="Collapse column"
        >
          <h3 className={`text-sm font-semibold ${colStyle.text}`}>{status}</h3>
        </button>

        {/* Count + WIP */}
        <div className="relative flex items-center gap-1" ref={wipRef}>
          <button
            onClick={() => { setEditingWip(!editingWip); setWipInput(wipLimit || '') }}
            className={`text-xs font-medium px-1.5 py-0.5 rounded-md transition-colors
              ${isOverLimit
                ? 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400'
                : isNearLimit
                  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400'
                  : 'bg-slate-100 text-slate-500 dark:bg-dark-border dark:text-slate-400'
              }`}
            title="Set WIP limit"
          >
            {wipLimit ? `${tasks.length}/${wipLimit}` : tasks.length}
          </button>

          {/* WIP limit popover */}
          <AnimatePresence>
            {editingWip && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="absolute top-full right-0 mt-1 bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border rounded-xl shadow-elevated p-3 z-40 w-44"
              >
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">WIP Limit</p>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={wipInput}
                    onChange={e => setWipInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { onSetWipLimit(parseInt(wipInput) || null); setEditingWip(false) } }}
                    className="form-input w-16 text-xs py-1 px-2"
                    placeholder="#"
                    autoFocus
                  />
                  <button
                    onClick={() => { onSetWipLimit(parseInt(wipInput) || null); setEditingWip(false) }}
                    className="btn-primary text-xs py-1 px-2.5"
                  >
                    Set
                  </button>
                </div>
                {wipLimit && (
                  <button
                    onClick={() => { onSetWipLimit(null); setEditingWip(false) }}
                    className="text-xs text-slate-400 hover:text-red-500 mt-2 transition-colors"
                  >
                    Clear limit
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Quick-add button */}
        {onQuickAdd && (
          <button
            onClick={() => onQuickAdd(status)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-white/60 dark:hover:text-slate-200 dark:hover:bg-dark-hover transition-colors"
            title={`Add task to ${status}`}
          >
            <Plus size={15} />
          </button>
        )}
      </div>

      {/* Droppable area */}
      <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`flex-1 rounded-xl p-2 space-y-2 overflow-y-auto transition-all duration-200
            bg-slate-100/60 dark:bg-dark-bg/50 border border-slate-200/50 dark:border-transparent
            ${isOver ? `ring-2 ${colStyle.ring} bg-slate-100 dark:bg-dark-hover/50` : ''}
            ${isOverLimit ? 'ring-1 ring-red-200 dark:ring-red-500/20' : ''}`}
          style={{ maxHeight: 'calc(100vh - 310px)' }}
        >
          <AnimatePresence mode="popLayout">
            {tasks.map((task, i) => (
              <motion.div
                key={task.id}
                layout
                layoutId={task.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.2, delay: i * 0.02 }}
              >
                <KanbanCard
                  task={task}
                  onClick={onCardClick}
                  onUpdateTask={onUpdateTask}
                  onDeleteTask={onDeleteTask}
                  onRefetch={onRefetch}
                />
              </motion.div>
            ))}
          </AnimatePresence>

          {tasks.length === 0 && (
            <div className="flex items-center justify-center py-12 border-2 border-dashed border-slate-300/60 dark:border-dark-border rounded-xl">
              <p className="text-xs text-slate-400 dark:text-slate-500">No tasks</p>
            </div>
          )}
        </div>
      </SortableContext>
    </motion.div>
  )
}
