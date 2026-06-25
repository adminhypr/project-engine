import { useState, useRef, useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, MoreHorizontal, Pencil, Trash2, Check } from 'lucide-react'
import FeatureCard from './FeatureCard'

const STATUS_OPTIONS = ['Not Started', 'In Progress', 'Blocked', 'Done']

function SortableFeature({ feature, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: feature.id,
    transition: { duration: 200, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  })
  const style = { transform: CSS.Transform.toString(transform), transition }
  if (isDragging) {
    return (
      <div ref={setNodeRef} style={style} aria-hidden
        className="rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 bg-black/[0.03] dark:bg-white/[0.03]">
        <div className="invisible"><FeatureCard feature={feature} /></div>
      </div>
    )
  }
  return (
    <div ref={setNodeRef} style={style}>
      <FeatureCard feature={feature} onClick={() => onOpen(feature)} dragHandleProps={{ ...attributes, ...listeners }} />
    </div>
  )
}

// Kebab menu: rename, status-mapping, delete — kept OFF the board (Trello-style).
function ColumnMenu({ column, onUpdateColumn, onDeleteColumn, onStartRename }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} className="p-1 rounded text-slate-500 hover:bg-black/10 dark:hover:bg-white/10" title="List actions">
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-52 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-elevated py-1 text-sm">
          <button onClick={() => { setOpen(false); onStartRename() }} className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 text-left">
            <Pencil size={13} className="text-slate-400" /> Rename list
          </button>
          <div className="my-1 border-t border-slate-100 dark:border-dark-border" />
          <div className="px-3 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Move here sets status</div>
          <button onClick={() => onUpdateColumn(column.id, { maps_to_status: null })}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 text-left">
            <span className="w-3.5 shrink-0">{!column.maps_to_status && <Check size={13} className="text-brand-500" />}</span> No mapping
          </button>
          {STATUS_OPTIONS.map(s => (
            <button key={s} onClick={() => onUpdateColumn(column.id, { maps_to_status: s })}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 text-left">
              <span className="w-3.5 shrink-0">{column.maps_to_status === s && <Check size={13} className="text-brand-500" />}</span> {s}
            </button>
          ))}
          <div className="my-1 border-t border-slate-100 dark:border-dark-border" />
          <button onClick={() => { setOpen(false); onDeleteColumn(column) }} className="w-full flex items-center gap-2 px-3 py-1.5 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 text-left">
            <Trash2 size={13} /> Delete list
          </button>
        </div>
      )}
    </div>
  )
}

export default function FeatureColumn({
  column, cards, isAdmin, activeId,
  onOpenFeature, onAddFeature, onUpdateColumn, onDeleteColumn,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` })
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(column.name)
  const addSubmitted = useRef(false)
  const renameSubmitted = useRef(false)
  useEffect(() => { setDraft(column.name) }, [column.name])

  const cardIds = cards.map(c => c.id)

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col w-[272px] shrink-0 max-h-full rounded-xl bg-slate-100 dark:bg-[#1d2127] shadow-sm transition-shadow ${
        isOver ? 'ring-2 ring-brand-400/70' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-1 px-3 pt-2.5 pb-1.5">
        {renaming ? (
          <input
            autoFocus value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { renameSubmitted.current = true; onUpdateColumn(column.id, { name: draft.trim() || column.name }); setRenaming(false) }
              if (e.key === 'Escape') { renameSubmitted.current = true; setDraft(column.name); setRenaming(false) }
            }}
            onBlur={() => { if (renameSubmitted.current) { renameSubmitted.current = false; return } onUpdateColumn(column.id, { name: draft.trim() || column.name }); setRenaming(false) }}
            className="form-input text-[13px] font-semibold py-0.5 px-1.5 min-w-0 flex-1"
          />
        ) : (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 truncate">{column.name}</span>
            <span className="text-xs text-slate-400 bg-black/[0.04] dark:bg-white/[0.06] rounded-full px-1.5 leading-5">{cards.length}</span>
          </div>
        )}
        {isAdmin && !renaming && (
          <ColumnMenu column={column} onUpdateColumn={onUpdateColumn} onDeleteColumn={onDeleteColumn} onStartRename={() => setRenaming(true)} />
        )}
      </div>

      {/* Cards (scrollable) */}
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div className="flex-1 overflow-y-auto space-y-2 px-2 pb-1 min-h-[8px]">
          {cards.map(c => <SortableFeature key={c.id} feature={c} onOpen={onOpenFeature} />)}
        </div>
      </SortableContext>

      {/* Footer add */}
      {adding ? (
        <div className="p-2">
          <textarea
            autoFocus value={title} rows={2}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={async e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (title.trim()) { addSubmitted.current = true; await onAddFeature({ title: title.trim(), columnId: column.id }); setTitle('') } }
              if (e.key === 'Escape') { addSubmitted.current = true; setTitle(''); setAdding(false) }
            }}
            onBlur={() => { if (addSubmitted.current) { addSubmitted.current = false; return } if (title.trim()) onAddFeature({ title: title.trim(), columnId: column.id }); setTitle(''); setAdding(false) }}
            placeholder="Enter a title…"
            className="w-full text-[13px] rounded-lg border border-slate-300 dark:border-dark-border bg-white dark:bg-[#22272b] p-2 resize-none focus:outline-none focus:ring-2 focus:ring-brand-400/50"
          />
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="m-2 flex items-center gap-1.5 px-2 py-1.5 text-[13px] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] rounded-lg transition-colors">
          <Plus size={15} /> Add a card
        </button>
      )}
    </div>
  )
}
