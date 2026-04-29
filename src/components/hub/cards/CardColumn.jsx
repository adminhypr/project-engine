import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import CardPreview from './CardPreview'

function SortableCardPreview({ card, onClick }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardPreview card={card} onClick={onClick} />
    </div>
  )
}

export default function CardColumn({
  column, cards, canManage,
  onOpenCard, onAddCard, onRenameColumn, onDeleteColumn,
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.id}` })
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(column.name)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const cardIds = cards.map(c => c.id)

  return (
    <div ref={setNodeRef} className={`flex flex-col min-w-[260px] w-[260px] rounded-2xl bg-slate-50 dark:bg-dark-bg/40 p-2 border ${isOver ? 'border-brand-300 dark:border-brand-500' : 'border-transparent'}`}>
      <div className="flex items-center justify-between gap-1 px-2 py-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: column.color }} />
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { onRenameColumn(column.id, draft); setRenaming(false) }
                if (e.key === 'Escape') { setDraft(column.name); setRenaming(false) }
              }}
              onBlur={() => { onRenameColumn(column.id, draft); setRenaming(false) }}
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
                await onAddCard(column.id, newTitle.trim())
                setNewTitle('')
                setAdding(false)
              }
              if (e.key === 'Escape') { setNewTitle(''); setAdding(false) }
            }}
            onBlur={() => { setNewTitle(''); setAdding(false) }}
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
