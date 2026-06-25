import { useState } from 'react'
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  PointerSensor, TouchSensor, useSensor, useSensors, pointerWithin,
} from '@dnd-kit/core'
import { Plus, ArrowUpRight, AlignLeft } from 'lucide-react'
import { groupBugsByStatus } from '../../lib/projectBoard'
import { SeverityChip } from './BugList'

const CANVAS = 'rounded-xl bg-gradient-to-br from-slate-500/10 to-slate-600/10 dark:from-white/[0.04] dark:to-white/[0.02] p-3'

function BugBody({ bug, onPromote, grabbing }) {
  const canPromote = bug.status !== 'Promoted' && bug.status !== "Won't Fix"
  return (
    <div className={`bg-white dark:bg-[#22272b] rounded-lg border border-slate-200/80 dark:border-white/5 shadow-[0_1px_1px_rgba(9,30,66,0.13)] p-2.5 ${grabbing ? 'cursor-grabbing rotate-2 ring-2 ring-brand-400/70 shadow-elevated' : 'cursor-grab hover:border-brand-400 dark:hover:border-brand-500/60'} transition-colors`}>
      <div className="flex items-start gap-1.5">
        <SeverityChip severity={bug.severity} />
        <p className="text-[13px] leading-snug text-slate-800 dark:text-slate-100 flex-1 min-w-0">{bug.title}</p>
      </div>
      <div className="flex items-center gap-2 mt-1">
        {bug.reporter?.full_name && <p className="text-[11px] text-slate-400">by {bug.reporter.full_name}</p>}
        {bug.description && <AlignLeft size={12} className="text-slate-400" title="Has details" />}
      </div>
      {canPromote && onPromote && (
        <button
          onClick={(e) => { e.stopPropagation(); onPromote(bug) }}
          onPointerDown={(e) => e.stopPropagation()}
          className="mt-2 text-[11px] text-brand-600 dark:text-brand-300 hover:underline inline-flex items-center gap-1"
        >
          <ArrowUpRight size={11} /> Promote
        </button>
      )}
    </div>
  )
}

function BugCard({ bug, onPromote, onOpen }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: bug.id })
  return (
    <div ref={setNodeRef} style={{ opacity: isDragging ? 0.4 : 1 }} {...attributes} {...listeners}
      onClick={() => onOpen(bug)}>
      <BugBody bug={bug} onPromote={onPromote} />
    </div>
  )
}

function StatusColumn({ status, count, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `status:${status}` })
  return (
    <div ref={setNodeRef}
      className={`flex flex-col w-[240px] shrink-0 rounded-xl bg-slate-100 dark:bg-[#1d2127] shadow-sm transition-shadow ${isOver ? 'ring-2 ring-brand-400/70' : ''}`}>
      <div className="px-3 pt-2.5 pb-1.5 flex items-center gap-1.5">
        <span className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">{status}</span>
        <span className="text-xs text-slate-400 bg-black/[0.04] dark:bg-white/[0.06] rounded-full px-1.5 leading-5">{count}</span>
      </div>
      <div className="space-y-2 px-2 pb-2 min-h-[8px]">{children}</div>
    </div>
  )
}

export default function BugBoard({ bugs, onPromote, onOpenBug }) {
  const { bugs: list, addBug, setStatus } = bugs
  const groups = groupBugsByStatus(list)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [activeId, setActiveId] = useState(null)
  const activeBug = activeId ? list.find(b => b.id === activeId) : null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  async function handleDragEnd(event) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return
    const overId = String(over.id)
    if (!overId.startsWith('status:')) return
    const newStatus = overId.slice('status:'.length)
    const bug = list.find(b => b.id === active.id)
    if (bug && bug.status !== newStatus) await setStatus(active.id, newStatus)
  }

  const add = async () => { if (title.trim()) await addBug({ title: title.trim(), severity: 'Medium' }); setTitle(''); setAdding(false) }

  return (
    <div>
      <div className="mb-2">
        {adding ? (
          <input
            autoFocus value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setTitle(''); setAdding(false) } }}
            onBlur={add}
            placeholder="Report a bug…"
            className="form-input text-sm w-full max-w-sm"
          />
        ) : (
          <button onClick={() => setAdding(true)} className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5">
            <Plus size={13} /> Report a bug
          </button>
        )}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={e => setActiveId(e.active.id)}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={handleDragEnd}
      >
        <div className={`${CANVAS} overflow-x-auto`}>
          <div className="flex gap-3 items-start min-h-[100px]">
            {groups.map(group => (
              <StatusColumn key={group.status} status={group.status} count={group.bugs.length}>
                {group.bugs.map(b => (
                  <BugCard key={b.id} bug={b} onPromote={onPromote} onOpen={onOpenBug} />
                ))}
              </StatusColumn>
            ))}
          </div>
        </div>

        <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
          {activeBug ? <div style={{ width: 224 }}><BugBody bug={activeBug} grabbing /></div> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
