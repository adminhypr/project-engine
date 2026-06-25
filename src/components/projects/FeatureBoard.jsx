import { useMemo, useState } from 'react'
import {
  DndContext, DragOverlay, closestCorners, pointerWithin, rectIntersection,
  PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { groupFeaturesByColumn, fractionalPos } from '../../lib/projectBoard'
import FeatureColumn from './FeatureColumn'
import FeatureCard from './FeatureCard'

function collisionDetection(args) {
  const ptr = pointerWithin(args)
  if (ptr.length) return ptr
  const inter = rectIntersection(args)
  if (inter.length) return inter
  return closestCorners(args)
}

// The board "canvas" — a soft colored backdrop so the gray lists + white cards
// layer on top the way they do in Trello.
const CANVAS = 'rounded-xl bg-gradient-to-br from-brand-500/10 to-brand-600/10 dark:from-brand-500/[0.06] dark:to-brand-700/[0.06] p-3'

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
    const targetCards = (cardsByCol.get(toCol) || []).filter(c => c.id !== active.id)
    let toIndex = targetCards.length
    if (over.id !== `col:${toCol}`) {
      const idx = targetCards.findIndex(c => c.id === over.id)
      if (idx !== -1) toIndex = idx
    }
    const before = targetCards[toIndex - 1]?.project_pos ?? null
    const after = targetCards[toIndex]?.project_pos ?? null
    await onMoveFeature(active.id, toCol, fractionalPos(before, after))
  }

  if (columnsLoading) return <div className={CANVAS}><div className="text-sm text-slate-500 px-2 py-6">Loading board…</div></div>

  if (columns.length === 0) {
    return (
      <div className={CANVAS}>
        <div className="text-sm text-slate-600 dark:text-slate-300 px-1 py-2">
          {isAdmin
            ? <>No lists yet. <button onClick={() => onAddColumn({ name: 'Backlog' })} className="text-brand-600 dark:text-brand-300 font-medium hover:underline">Add the first list</button>.</>
            : <>This board has no lists yet.</>}
        </div>
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
      <div className={`${CANVAS} overflow-x-auto`}>
        <div className="flex gap-3 items-start min-h-[120px]">
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
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {activeFeature ? (
          <div className="rotate-3 shadow-elevated" style={{ width: 256 }}>
            <FeatureCard feature={activeFeature} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function AddColumnInline({ onAdd }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const submit = async () => { if (name.trim()) await onAdd({ name: name.trim() }); setName(''); setAdding(false) }
  if (!adding) {
    return (
      <button onClick={() => setAdding(true)}
        className="w-[272px] shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium text-slate-600 dark:text-slate-300 rounded-xl bg-white/50 hover:bg-white/80 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] transition-colors">
        <Plus size={15} /> Add a list
      </button>
    )
  }
  return (
    <div className="w-[272px] shrink-0 rounded-xl bg-slate-100 dark:bg-[#1d2127] shadow-sm p-2">
      <input
        autoFocus value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') { setName(''); setAdding(false) } }}
        onBlur={submit}
        placeholder="Enter list name…"
        className="w-full text-[13px] rounded-lg border border-slate-300 dark:border-dark-border bg-white dark:bg-[#22272b] p-2 focus:outline-none focus:ring-2 focus:ring-brand-400/50"
      />
    </div>
  )
}
