import { useState, useEffect, useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import CardPreview from './CardPreview'

function SortableCardPreview({ card, onClick }) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({
    id: card.id,
    transition: {
      // dnd-kit applies this transition to siblings shifting out of the
      // way during drag. Smoother + slightly snappier than the default.
      duration: 220,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    },
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  // The DragOverlay (mounted in CardTable) renders the floating card that
  // follows the cursor. The source slot here keeps the layout space and
  // shows a dashed placeholder so the user sees where they're dragging
  // FROM. No content is rendered while it's the active drag.
  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-slate-100/50 dark:bg-white/[0.02]"
        aria-hidden
      >
        <div className="invisible">
          <CardPreview card={card} onClick={() => {}} />
        </div>
      </div>
    )
  }
  return (
    <div ref={setNodeRef} style={style}>
      <CardPreview
        card={card}
        onClick={onClick}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  )
}

export default function CardColumn({
  column, cards, canManage, activeId,
  onOpenCard, onAddCard, onRenameColumn, onDeleteColumn,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` })
  const dragging = !!activeId
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(column.name)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const renameSubmittedRef = useRef(false)
  const addSubmittedRef = useRef(false)

  // Keep draft in sync when column.name changes via realtime while
  // rename mode is closed.
  useEffect(() => { setDraft(column.name) }, [column.name])

  const cardIds = cards.map(c => c.id)

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[260px] w-[260px] rounded-2xl p-2 border transition-colors duration-150 ${
        isOver
          ? 'bg-brand-50/40 dark:bg-brand-500/[0.08] border-brand-300 dark:border-brand-500'
          : dragging
            ? 'bg-slate-50 dark:bg-dark-bg/40 border-slate-200/60 dark:border-slate-700/40'
            : 'bg-slate-50 dark:bg-dark-bg/40 border-transparent'
      }`}
    >
      <div className="flex items-center justify-between gap-1 px-2 py-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: column.color }} />
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  renameSubmittedRef.current = true
                  onRenameColumn(column.id, draft)
                  setRenaming(false)
                }
                if (e.key === 'Escape') {
                  renameSubmittedRef.current = true
                  setDraft(column.name)
                  setRenaming(false)
                }
              }}
              onBlur={() => {
                if (renameSubmittedRef.current) { renameSubmittedRef.current = false; return }
                onRenameColumn(column.id, draft)
                setRenaming(false)
              }}
              className="form-input text-sm font-bold py-0 px-1 min-w-0 flex-1"
            />
          ) : (
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200 truncate">{column.name}</span>
          )}
          <span className="text-xs text-slate-400">{cards.length}</span>
        </div>
        {canManage && !renaming && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button type="button" onClick={() => setRenaming(true)} className="p-1 rounded text-slate-400 hover:text-brand-500" title="Rename"><Pencil size={12} /></button>
            <button type="button" onClick={() => onDeleteColumn(column)} className="p-1 rounded text-slate-400 hover:text-red-500" title="Delete column"><Trash2 size={12} /></button>
          </div>
        )}
      </div>

      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div className="space-y-2 px-1 pb-1 min-h-[40px]">
          {cards.map(c => (
            <SortableCardPreview key={c.id} card={c} onClick={() => onOpenCard(c.id)} />
          ))}
        </div>
      </SortableContext>

      {adding ? (
        <div className="px-1">
          <input
            autoFocus
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === 'Enter' && newTitle.trim()) {
                addSubmittedRef.current = true
                await onAddCard(column.id, newTitle.trim())
                setNewTitle('')
                setAdding(false)
              }
              if (e.key === 'Escape') {
                addSubmittedRef.current = true
                setNewTitle('')
                setAdding(false)
              }
            }}
            onBlur={() => {
              if (addSubmittedRef.current) { addSubmittedRef.current = false; return }
              setNewTitle('')
              setAdding(false)
            }}
            placeholder="Card title"
            className="form-input text-sm w-full"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1 mx-1 flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-500 hover:text-brand-500 hover:bg-white dark:hover:bg-dark-card rounded-lg transition-colors"
        >
          <Plus size={12} />
          Add a card
        </button>
      )}
    </div>
  )
}
