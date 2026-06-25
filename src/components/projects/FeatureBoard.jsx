import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, closestCorners, pointerWithin, rectIntersection,
  PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { groupFeaturesByColumn, fractionalPos } from '../../lib/projectBoard'
import { showToast } from '../ui/index'
import FeatureColumn from './FeatureColumn'
import FeatureCard from './FeatureCard'

function collisionDetection(args) {
  const ptr = pointerWithin(args)
  if (ptr.length) return ptr
  const inter = rectIntersection(args)
  if (inter.length) return inter
  return closestCorners(args)
}

export default function FeatureBoard({
  columns, columnsLoading, features, isAdmin,
  onAddFeature, onMoveFeature, onAddColumn, onUpdateColumn, onDeleteColumn, onOpenFeature,
}) {
  const [activeId, setActiveId] = useState(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  const grouped = useMemo(() => groupFeaturesByColumn(features, columns), [features, columns])
  const cardsByCol = useMemo(() => {
    const m = new Map()
    for (const g of grouped) m.set(g.column.id, g.cards)
    return m
  }, [grouped])

  const activeFeature = activeId ? features.find(f => f.id === activeId) : null

  function findColumnFor(id) {
    if (typeof id === 'string' && id.startsWith('col:')) return id.slice(4)
    return features.find(f => f.id === id)?.project_column_id || null
  }

  async function handleDragEnd(event) {
    setActiveId(null)
    const { active, over } = event
    if (!over || over.id === active.id) return
    const toCol = findColumnFor(over.id)
    if (!toCol) return

    // Target column cards, excluding the dragged one, ordered by project_pos.
    const targetCards = (cardsByCol.get(toCol) || []).filter(c => c.id !== active.id)
    let toIndex = targetCards.length
    if (over.id !== `col:${toCol}`) {
      const idx = targetCards.findIndex(c => c.id === over.id)
      if (idx !== -1) toIndex = idx
    }
    const before = targetCards[toIndex - 1]?.project_pos ?? null
    const after = targetCards[toIndex]?.project_pos ?? null
    const newPos = fractionalPos(before, after)
    await onMoveFeature(active.id, toCol, newPos)
  }

  if (columnsLoading) return <div className="p-4 text-sm text-slate-400">Loading board…</div>

  if (columns.length === 0) {
    return (
      <div className="p-4 text-sm text-slate-500 dark:text-slate-400">
        {isAdmin
          ? <>No lists yet. <AddColumnInline onAdd={onAddColumn} trigger="link" /></>
          : <>This board has no lists yet.</>}
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={e => setActiveId(e.active.id)}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-3 overflow-x-auto pb-2 group">
        {columns.map(col => (
          <FeatureColumn
            key={col.id}
            column={col}
            cards={cardsByCol.get(col.id) || []}
            isAdmin={isAdmin}
            activeId={activeId}
            onOpenFeature={onOpenFeature}
            onAddFeature={onAddFeature}
            onUpdateColumn={onUpdateColumn}
            onDeleteColumn={async (c) => {
              if (!confirm(`Delete list "${c.name}"? Features in it become un-listed (still tasks).`)) return
              await onDeleteColumn(c.id)
            }}
          />
        ))}
        {isAdmin && <AddColumnInline onAdd={onAddColumn} />}
      </div>

      <DragOverlay dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {activeFeature ? (
          <div className="rotate-2 scale-[1.03] shadow-elevated rounded-xl ring-2 ring-brand-400/60 cursor-grabbing" style={{ width: 240 }}>
            <FeatureCard feature={activeFeature} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function AddColumnInline({ onAdd, trigger = 'column' }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const submit = async () => {
    if (name.trim()) await onAdd({ name: name.trim() })
    setName(''); setAdding(false)
  }
  if (trigger === 'link') {
    return <button onClick={() => onAdd({ name: 'Backlog' })} className="text-brand-500 hover:underline">Add the first list</button>
  }
  if (!adding) {
    return (
      <button onClick={() => setAdding(true)}
        className="min-w-[200px] h-9 flex items-center gap-1.5 px-3 text-xs text-slate-500 hover:text-brand-500 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 self-start">
        <Plus size={13} /> Add a list
      </button>
    )
  }
  return (
    <div className="min-w-[220px] self-start">
      <input
        autoFocus value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setName(''); setAdding(false) } }}
        onBlur={submit}
        placeholder="List name"
        className="form-input text-sm w-full"
      />
    </div>
  )
}
