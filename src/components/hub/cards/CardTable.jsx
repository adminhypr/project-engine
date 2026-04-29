import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  DndContext, DragOverlay, closestCorners, pointerWithin, rectIntersection,
  PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { useHubCardColumns } from '../../../hooks/useHubCardColumns'
import { useHubCards } from '../../../hooks/useHubCards'
import { useHubs } from '../../../hooks/useHubs'
import { useAuth } from '../../../hooks/useAuth'
import { groupCardsByColumn } from '../../../lib/cards'
import { showToast } from '../../ui/index'
import CardColumn from './CardColumn'
import AddColumnInline from './AddColumnInline'
import CardPreview from './CardPreview'

function collisionDetection(args) {
  const ptr = pointerWithin(args)
  if (ptr.length) return ptr
  const inter = rectIntersection(args)
  if (inter.length) return inter
  return closestCorners(args)
}

export default function CardTable({ hubId, moduleId }) {
  const { isAdmin } = useAuth()
  const { hubs } = useHubs()
  const hub = hubs.find(h => h.id === hubId)
  const myRole = hub?.my_role || 'member'
  const canManage = isAdmin || myRole === 'owner' || myRole === 'admin'

  const { columns, loading: colsLoading, addColumn, renameColumn, deleteColumn } = useHubCardColumns(moduleId)
  const { cards, loading: cardsLoading, addCard, moveCard } = useHubCards(moduleId)
  const [, setSearchParams] = useSearchParams()
  const [activeId, setActiveId] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  const grouped = useMemo(() => groupCardsByColumn(cards, columns.map(c => c.id)), [cards, columns])
  const activeCard = activeId ? cards.find(c => c.id === activeId) : null

  function findColumnFor(id) {
    if (typeof id === 'string' && id.startsWith('col:')) return id.slice(4)
    const card = cards.find(c => c.id === id)
    return card?.column_id || null
  }

  function handleDragStart(event) {
    setActiveId(event.active.id)
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  async function handleDragEnd(event) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const fromColId = findColumnFor(active.id)
    const toColId   = findColumnFor(over.id)
    if (!fromColId || !toColId) return

    const sourceCol = grouped[fromColId] || []
    const targetCol = grouped[toColId] || []
    const fromIdx = sourceCol.findIndex(c => c.id === active.id)
    let toIndex = targetCol.length
    if (over.id !== `col:${toColId}`) {
      const idx = targetCol.findIndex(c => c.id === over.id)
      if (idx !== -1) toIndex = idx
    }
    // Same-column downward: the source still occupies its old slot in
    // targetCol, so the over-card's index is one past where we actually
    // want to land after removal.
    if (fromColId === toColId && fromIdx !== -1 && fromIdx < toIndex) {
      toIndex -= 1
    }
    // No-op if nothing changed
    if (fromColId === toColId && fromIdx === toIndex) return
    await moveCard(active.id, { columnId: toColId, position: toIndex })
  }

  function openCard(cardId) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('card', cardId)
      return next
    })
  }

  if (colsLoading || cardsLoading) {
    return <div className="p-4 text-sm text-slate-400">Loading cards…</div>
  }

  if (columns.length === 0) {
    return (
      <div className="p-4 text-sm text-slate-500 dark:text-slate-400">
        {canManage
          ? <>No columns yet. <button onClick={() => addColumn('To do')} className="text-brand-500 hover:underline">Add the first column</button>.</>
          : <>This Card Table has no columns yet.</>}
      </div>
    )
  }

  return (
    <div className="px-3 py-3">
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex gap-3 overflow-x-auto pb-2 group">
          {columns.map(col => (
            <CardColumn
              key={col.id}
              column={col}
              cards={grouped[col.id] || []}
              canManage={canManage}
              activeId={activeId}
              onOpenCard={openCard}
              onAddCard={async (colId, title) => {
                const created = await addCard({ columnId: colId, title })
                if (created) showToast('Card added')
              }}
              onRenameColumn={renameColumn}
              onDeleteColumn={async (c) => {
                if (!confirm(`Delete column "${c.name}"? Cards must be moved or deleted first.`)) return
                await deleteColumn(c.id)
              }}
            />
          ))}
          {canManage && <AddColumnInline onAdd={addColumn} />}
        </div>

        {/* Floating preview that follows the cursor while dragging.
            Tilts + scales for a "lifted off the board" feel. */}
        <DragOverlay
          dropAnimation={{
            duration: 220,
            easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
          }}
        >
          {activeCard ? (
            <div
              className="rotate-2 scale-[1.03] shadow-elevated rounded-xl ring-2 ring-brand-400/60 dark:ring-brand-500/50 cursor-grabbing"
              style={{ width: 240 }}
            >
              <CardPreview card={activeCard} onClick={() => {}} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
