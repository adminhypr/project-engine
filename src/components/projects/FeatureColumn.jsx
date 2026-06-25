import { useState, useRef, useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import FeatureCard from './FeatureCard'

const STATUS_OPTIONS = ['Not Started', 'In Progress', 'Blocked', 'Done']

function SortableFeature({ feature, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: feature.id,
    transition: { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  })
  const style = { transform: CSS.Transform.toString(transform), transition }
  if (isDragging) {
    return (
      <div ref={setNodeRef} style={style} aria-hidden
        className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-100/50 dark:bg-white/[0.02]">
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

export default function FeatureColumn({
  column, cards, isAdmin, activeId,
  onOpenFeature, onAddFeature, onUpdateColumn, onDeleteColumn,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` })
  const dragging = !!activeId
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
      className={`flex flex-col min-w-[260px] w-[260px] rounded-2xl p-2 border transition-colors ${
        isOver
          ? 'bg-brand-50/40 dark:bg-brand-500/[0.08] border-brand-300 dark:border-brand-500'
          : 'bg-slate-50 dark:bg-dark-bg/40 border-transparent'
      }`}
    >
      <div className="flex items-center justify-between gap-1 px-2 py-1">
        <div className="flex items-center gap-2 min-w-0">
          {column.color && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: column.color }} />}
          {renaming ? (
            <input
              autoFocus value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { renameSubmitted.current = true; onUpdateColumn(column.id, { name: draft.trim() || column.name }); setRenaming(false) }
                if (e.key === 'Escape') { renameSubmitted.current = true; setDraft(column.name); setRenaming(false) }
              }}
              onBlur={() => { if (renameSubmitted.current) { renameSubmitted.current = false; return } onUpdateColumn(column.id, { name: draft.trim() || column.name }); setRenaming(false) }}
              className="form-input text-sm font-bold py-0 px-1 min-w-0 flex-1"
            />
          ) : (
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{column.name}</span>
          )}
          <span className="text-xs text-slate-400">{cards.length}</span>
          {column.maps_to_status && (
            <span className="text-[10px] text-slate-400 dark:text-slate-500 truncate" title={`Dropping here sets status: ${column.maps_to_status}`}>
              → {column.maps_to_status}
            </span>
          )}
        </div>
        {isAdmin && !renaming && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button type="button" onClick={() => setRenaming(true)} className="p-1 rounded text-slate-400 hover:text-brand-500" title="Rename"><Pencil size={12} /></button>
            <button type="button" onClick={() => onDeleteColumn(column)} className="p-1 rounded text-slate-400 hover:text-red-500" title="Delete list"><Trash2 size={12} /></button>
          </div>
        )}
      </div>

      {/* Admin: status-mapping picker */}
      {isAdmin && (
        <div className="px-2 pb-1">
          <select
            value={column.maps_to_status || ''}
            onChange={e => onUpdateColumn(column.id, { maps_to_status: e.target.value || null })}
            className="form-input text-[11px] py-0.5 px-1 w-full text-slate-500"
            title="Map this list to a task status (optional)"
          >
            <option value="">No status mapping</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>Maps to: {s}</option>)}
          </select>
        </div>
      )}

      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-2 px-1 pb-1 min-h-[40px]">
          {cards.map(c => <SortableFeature key={c.id} feature={c} onOpen={onOpenFeature} />)}
        </div>
      </SortableContext>

      {adding ? (
        <div className="px-1">
          <input
            autoFocus value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={async e => {
              if (e.key === 'Enter' && title.trim()) { addSubmitted.current = true; await onAddFeature({ title: title.trim(), columnId: column.id }); setTitle(''); setAdding(false) }
              if (e.key === 'Escape') { addSubmitted.current = true; setTitle(''); setAdding(false) }
            }}
            onBlur={() => { if (addSubmitted.current) { addSubmitted.current = false; return } setTitle(''); setAdding(false) }}
            placeholder="Feature title"
            className="form-input text-sm w-full"
          />
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="mt-1 mx-1 flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-500 hover:text-brand-500 hover:bg-white dark:hover:bg-dark-card rounded-lg transition-colors">
          <Plus size={12} /> Add a feature
        </button>
      )}
    </div>
  )
}
