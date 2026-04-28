import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Pencil, Trash2, Check, X as XIcon, Maximize2 } from 'lucide-react'

// `onRename(nextTitle)` and `onDelete()` are optional. When provided, the
// card shows owner-only inline rename + a delete button on hover. Pages
// pass them as null/undefined for non-owners or for fixed (non-editable)
// modules; the controls hide automatically.
//
// `onExpand()` opens the module in a focused floating-window view
// (Basecamp-style). Available to anyone, not just owners.
export default function HubModuleCard({
  title, icon: Icon, children, defaultOpen = true, badge, color = '#6366f1',
  onRename, onDelete, onExpand,
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef(null)

  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])
  useEffect(() => { setDraft(title) }, [title])

  async function commitRename() {
    const next = draft.trim()
    if (!next || next === title) { setEditing(false); setDraft(title); return }
    if (onRename) await onRename(next)
    setEditing(false)
  }

  return (
    <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border rounded-2xl overflow-hidden shadow-card dark:shadow-none group/module">
      <div className="w-full flex items-center gap-3 px-5 py-4">
        {Icon && (
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: `${color}18` }}
          >
            <Icon size={15} style={{ color }} />
          </div>
        )}
        {editing ? (
          <div className="flex-1 flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') { setEditing(false); setDraft(title) }
              }}
              maxLength={80}
              className="form-input text-sm font-bold py-1 px-2 flex-1"
            />
            <button
              type="button"
              onClick={commitRename}
              className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
              title="Save"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setDraft(title) }}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-dark-hover"
              title="Cancel"
            >
              <XIcon size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setOpen(v => !v)}
            className="flex-1 text-left flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors -mx-2 -my-1.5 px-2 py-1.5 rounded-lg"
          >
            <span className="text-sm font-bold text-slate-900 dark:text-white flex-1">{title}</span>
            {badge != null && (
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: `${color}18`, color }}
              >
                {badge}
              </span>
            )}
            <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown size={15} className="text-slate-400" />
            </motion.div>
          </button>
        )}
        {!editing && (onRename || onDelete || onExpand) && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover/module:opacity-100 transition-opacity">
            {onExpand && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onExpand() }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-dark-hover"
                title="Expand"
              >
                <Maximize2 size={13} />
              </button>
            )}
            {onRename && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setEditing(true) }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-brand-500 hover:bg-slate-100 dark:hover:bg-dark-hover"
                title="Rename"
              >
                <Pencil size={13} />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete() }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-dark-hover"
                title="Delete module"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="border-t border-slate-100 dark:border-dark-border px-5 py-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
