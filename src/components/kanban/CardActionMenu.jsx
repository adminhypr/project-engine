import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal, ArrowRight, Zap, Trash2 } from 'lucide-react'
import { showToast } from '../ui'

const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Done']
const URGENCIES = ['High', 'Med', 'Low']

export default function CardActionMenu({ task, onUpdateTask, onDeleteTask, onRefetch }) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  // Position menu relative to button using portal
  function toggleMenu(e) {
    e.stopPropagation()
    if (open) { setOpen(false); return }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) {
      setMenuPos({
        top: rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - 200),
      })
    }
    setOpen(true)
    setConfirmDelete(false)
  }

  // Close on click outside or Escape
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target) && !btnRef.current?.contains(e.target)) {
        setOpen(false)
      }
    }
    function handleKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKey) }
  }, [open])

  async function handleStatusChange(status) {
    setOpen(false)
    const result = await onUpdateTask(task.id, { status })
    if (result.ok) { showToast(`Status → ${status}`); onRefetch() }
    else showToast(result.msg || 'Failed', 'error')
  }

  async function handleUrgencyChange(urgency) {
    setOpen(false)
    const result = await onUpdateTask(task.id, { urgency })
    if (result.ok) { showToast(`Urgency → ${urgency}`); onRefetch() }
    else showToast(result.msg || 'Failed', 'error')
  }

  async function handleDelete() {
    setOpen(false)
    const result = await onDeleteTask(task.id)
    if (result.ok) { showToast('Task deleted'); onRefetch() }
    else showToast(result.msg || 'Failed to delete', 'error')
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggleMenu}
        onPointerDown={e => e.stopPropagation()}
        className="p-1 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-100 dark:text-slate-600 dark:hover:text-slate-300 dark:hover:bg-dark-hover transition-colors opacity-0 group-hover:opacity-100"
        title="Actions"
      >
        <MoreHorizontal size={14} />
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[60] bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border rounded-xl shadow-elevated py-1 w-48"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          {/* Status submenu */}
          <div className="px-2 py-1">
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-1 mb-1">Status</p>
            {STATUSES.filter(s => s !== task.status).map(s => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover rounded-lg transition-colors"
              >
                <ArrowRight size={12} className="text-slate-400" />
                {s}
              </button>
            ))}
          </div>

          <div className="border-t border-slate-100 dark:border-dark-border my-1" />

          {/* Urgency submenu */}
          <div className="px-2 py-1">
            <p className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-1 mb-1">Urgency</p>
            {URGENCIES.filter(u => u !== task.urgency).map(u => (
              <button
                key={u}
                onClick={() => handleUrgencyChange(u)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover rounded-lg transition-colors"
              >
                <Zap size={12} className="text-slate-400" />
                {u}
              </button>
            ))}
          </div>

          <div className="border-t border-slate-100 dark:border-dark-border my-1" />

          {/* Delete */}
          <div className="px-2 py-1">
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleDelete}
                  className="flex-1 px-2 py-1.5 text-xs font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg transition-colors"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-dark-hover rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <Trash2 size={12} />
                Delete
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
