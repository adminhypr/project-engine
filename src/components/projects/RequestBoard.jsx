import { useState } from 'react'
import {
  DndContext, useDraggable, useDroppable,
  PointerSensor, TouchSensor, useSensor, useSensors, pointerWithin,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Plus, ArrowUpRight } from 'lucide-react'
import { groupRequestsByStatus } from '../../lib/projectBoard'

function RequestCard({ request, onPromote }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: request.id })
  const style = { transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 }
  const canPromote = request.status !== 'Promoted' && request.status !== 'Rejected'
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className="bg-white dark:bg-dark-card rounded-lg border border-slate-200 dark:border-dark-border p-2.5 shadow-soft cursor-grab active:cursor-grabbing">
      <p className="text-sm text-slate-800 dark:text-slate-100 line-clamp-3">{request.title}</p>
      {request.requester?.full_name && <p className="text-[11px] text-slate-400 mt-1">by {request.requester.full_name}</p>}
      {canPromote && (
        <button
          onClick={(e) => { e.stopPropagation(); onPromote(request) }}
          onPointerDown={(e) => e.stopPropagation()}
          className="mt-2 text-[11px] text-brand-600 dark:text-brand-300 hover:underline inline-flex items-center gap-1"
        >
          <ArrowUpRight size={11} /> Promote
        </button>
      )}
    </div>
  )
}

function StatusColumn({ status, requests, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: `status:${status}` })
  return (
    <div ref={setNodeRef}
      className={`flex flex-col min-w-[220px] w-[220px] rounded-2xl p-2 border transition-colors ${
        isOver ? 'bg-brand-50/40 dark:bg-brand-500/[0.08] border-brand-300 dark:border-brand-500' : 'bg-slate-50 dark:bg-dark-bg/40 border-transparent'
      }`}>
      <div className="px-2 py-1 flex items-center gap-2">
        <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{status}</span>
        <span className="text-[11px] text-slate-400">{requests.length}</span>
      </div>
      <div className="space-y-2 px-1 pb-1 min-h-[40px]">{children}</div>
    </div>
  )
}

export default function RequestBoard({ requests, firstColumnId }) {
  const { requests: list, addRequest, setStatus, promote } = requests
  const groups = groupRequestsByStatus(list)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  async function handleDragEnd(event) {
    const { active, over } = event
    if (!over) return
    const overId = String(over.id)
    if (!overId.startsWith('status:')) return
    const newStatus = overId.slice('status:'.length)
    const req = list.find(r => r.id === active.id)
    if (req && req.status !== newStatus) await setStatus(active.id, newStatus)
  }

  const add = async () => {
    if (title.trim()) await addRequest({ title: title.trim() })
    setTitle(''); setAdding(false)
  }

  return (
    <div>
      <div className="mb-2">
        {adding ? (
          <input
            autoFocus value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') { setTitle(''); setAdding(false) } }}
            onBlur={add}
            placeholder="Request a feature…"
            className="form-input text-sm w-full max-w-sm"
          />
        ) : (
          <button onClick={() => setAdding(true)} className="btn-ghost text-xs px-3 py-1.5 flex items-center gap-1.5">
            <Plus size={13} /> Add request
          </button>
        )}
      </div>
      <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {groups.map(group => (
            <StatusColumn key={group.status} status={group.status} requests={group.requests}>
              {group.requests.map(r => (
                <RequestCard key={r.id} request={r} onPromote={(req) => promote(req, { columnId: firstColumnId })} />
              ))}
            </StatusColumn>
          ))}
        </div>
      </DndContext>
    </div>
  )
}
