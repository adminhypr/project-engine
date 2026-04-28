import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  DndContext, DragOverlay, closestCorners, pointerWithin, rectIntersection,
  PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { useHubs } from '../hooks/useHubs'
import { useAuth } from '../hooks/useAuth'
import { showToast } from '../components/ui'
import { useHubModules } from '../hooks/useHubModules'
import { PageTransition } from '../components/ui/animations'
import { LoadingScreen } from '../components/ui/index'
import HubList from '../components/hub/HubList'
import HubModuleCard from '../components/hub/HubModuleCard'
import SortableModuleCard from '../components/hub/SortableModuleCard'
import HubMembersPanel from '../components/hub/HubMembersPanel'
import Attendance from '../components/hub/Attendance'
import Campfire from '../components/hub/Campfire'
import MessageBoard from '../components/hub/MessageBoard'
import DocsFiles from '../components/hub/DocsFiles'
import TodosModuleCard from '../components/hub/todos/TodosModuleCard'
import AddModuleModal from '../components/hub/AddModuleModal'
import ExpandedModuleModal from '../components/hub/ExpandedModuleModal'
import {
  Users, Flame, MessageSquare, FolderOpen, ArrowLeft, CheckSquare,
  Pencil, Check, X as XIcon, Plus,
} from 'lucide-react'

const DEFAULT_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

// Per-kind visual config and component mapping. Title comes from the
// hub_modules row (renameable); these stay constant per kind.
export const KIND_META = {
  'message-board':   { icon: MessageSquare, color: '#7c3aed', defaultOpen: true,  Comp: MessageBoard },
  'to-dos':          { icon: CheckSquare,   color: '#8b5cf6', defaultOpen: true,  Comp: TodosModuleCard },
  'docs-files':      { icon: FolderOpen,    color: '#0284c7', defaultOpen: false, Comp: DocsFiles },
  'campfire':        { icon: Flame,         color: '#dc2626', defaultOpen: true,  Comp: Campfire },
  'attendance-room': { icon: Users,         color: '#8b5cf6', defaultOpen: true,  Comp: Attendance },
}

const COLUMN_IDS = ['col-0', 'col-1', 'col-2']

// Wraps a column's drop zone so dnd-kit recognizes the empty area as a
// valid target (otherwise dragging into an empty column wouldn't fire any
// `over` event).
function DroppableColumn({ id, children }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`min-w-0 min-h-[200px] rounded-2xl transition-colors ${
        isOver ? 'bg-slate-50/40 dark:bg-white/[0.02]' : ''
      }`}
    >
      {children}
    </div>
  )
}

function ModuleColumn({
  columnId, modules, hubId, canManage, onRename, onDelete, onExpand,
}) {
  const ids = modules.map(m => m.id)
  return (
    <DroppableColumn id={columnId}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-4">
          {modules.map(m => {
            const meta = KIND_META[m.kind]
            if (!meta) return null
            const Comp = meta.Comp
            return (
              <SortableModuleCard
                key={m.id}
                id={m.id}
                title={m.title}
                icon={meta.icon}
                color={meta.color}
                defaultOpen={meta.defaultOpen}
                onRename={canManage ? (nextTitle) => onRename(m.id, nextTitle) : null}
                onDelete={canManage ? () => onDelete(m) : null}
                onExpand={() => onExpand(m)}
              >
                <Comp hubId={hubId} moduleId={m.id} />
              </SortableModuleCard>
            )
          })}
        </div>
      </SortableContext>
    </DroppableColumn>
  )
}

// Find which column id (col-0/1/2) a draggable id belongs to inside the
// current local layout. Returns the column id when the id IS the column
// (drop on empty column) or when it's a module within that column.
function findColumnFor(id, columns) {
  if (typeof id === 'string' && id.startsWith('col-')) return id
  for (let i = 0; i < columns.length; i++) {
    if (columns[i].some(m => m.id === id)) return COLUMN_IDS[i]
  }
  return null
}

// Custom collision detection: prefer a pointer-within hit on a column,
// fall back to closestCorners against module rows. This keeps cross-column
// drops snappy without weird "jumps to top of empty column" behavior.
function moduleCollisionDetection(args) {
  const pointerHits = pointerWithin(args)
  if (pointerHits.length > 0) return pointerHits
  const intersect = rectIntersection(args)
  if (intersect.length > 0) return intersect
  return closestCorners(args)
}

function HubDashboard({ hubId }) {
  const { hubs, loading, updateHub } = useHubs()
  const { isAdmin } = useAuth()
  const { columns, addModule, renameModule, deleteModule, saveLayout, loading: modulesLoading } = useHubModules(hubId)
  const navigate = useNavigate()
  const [showMembers, setShowMembers] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [showAddModule, setShowAddModule] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [expandedModule, setExpandedModule] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)
  const nameInputRef = useRef(null)

  // Local mirror of the columns from useHubModules. Drag handlers mutate
  // this optimistically (so the UI reflects the move during drag), and
  // the persistent save fires on drop. When the upstream `columns` change
  // (realtime / refetch / saveLayout's optimistic reflect), sync into
  // local state — but skip the sync mid-drag so we don't fight ourselves.
  const [localColumns, setLocalColumns] = useState(columns)
  const draggingRef = useRef(false)
  useEffect(() => {
    if (!draggingRef.current) setLocalColumns(columns)
  }, [columns])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

  function handleDragStart(event) {
    draggingRef.current = true
    setActiveId(event.active.id)
  }

  function handleDragOver(event) {
    const { active, over } = event
    if (!over) return
    const activeColId = findColumnFor(active.id, localColumns)
    const overColId   = findColumnFor(over.id, localColumns)
    if (!activeColId || !overColId) return
    if (activeColId === overColId) return

    setLocalColumns(prev => {
      const fromIdx = COLUMN_IDS.indexOf(activeColId)
      const toIdx   = COLUMN_IDS.indexOf(overColId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const fromCol = [...prev[fromIdx]]
      const toCol   = [...prev[toIdx]]
      const movingIdx = fromCol.findIndex(m => m.id === active.id)
      if (movingIdx === -1) return prev
      const [moved] = fromCol.splice(movingIdx, 1)

      // Drop position in target column. If hovering over a module row,
      // insert above it; if over the column body itself, append to bottom.
      let insertAt = toCol.length
      if (over.id !== overColId) {
        const overIdxInTarget = toCol.findIndex(m => m.id === over.id)
        if (overIdxInTarget !== -1) insertAt = overIdxInTarget
      }
      toCol.splice(insertAt, 0, moved)

      const next = [prev[0], prev[1], prev[2]]
      next[fromIdx] = fromCol
      next[toIdx]   = toCol
      return next
    })
  }

  function handleDragEnd(event) {
    draggingRef.current = false
    const { active, over } = event
    setActiveId(null)
    if (!over) return

    const activeColId = findColumnFor(active.id, localColumns)
    const overColId   = findColumnFor(over.id, localColumns)
    if (!activeColId || !overColId) return

    let next = localColumns
    if (activeColId === overColId) {
      const colIdx = COLUMN_IDS.indexOf(activeColId)
      const col = localColumns[colIdx]
      const oldIdx = col.findIndex(m => m.id === active.id)
      // When over.id is the column container itself (empty drop area), no
      // intra-column reorder needed.
      const newIdx = over.id === overColId ? oldIdx : col.findIndex(m => m.id === over.id)
      if (newIdx !== -1 && oldIdx !== newIdx) {
        next = [...localColumns]
        next[colIdx] = arrayMove(col, oldIdx, newIdx)
        setLocalColumns(next)
      }
    }
    // Persist current local layout (covers same-column reorder + the
    // cross-column move that handleDragOver already applied).
    saveLayout(next)
  }

  function handleDragCancel() {
    draggingRef.current = false
    setActiveId(null)
    setLocalColumns(columns) // revert any optimistic dragOver moves
  }

  const hub = hubs.find(h => h.id === hubId)
  const hubName = hub?.name || 'Hub'
  const myRole = hub?.my_role || 'member'
  const color = hub?.color || DEFAULT_COLORS[Math.abs((hub?.name || '').charCodeAt(0)) % DEFAULT_COLORS.length]
  const canRenameHub = isAdmin || myRole === 'owner' || myRole === 'admin'

  useEffect(() => {
    if (editingName && nameInputRef.current) nameInputRef.current.select()
  }, [editingName])

  async function saveName() {
    const next = nameDraft.trim()
    if (!next) { showToast('Hub name cannot be empty', 'error'); return }
    if (next === hub?.name) { setEditingName(false); return }
    setSavingName(true)
    const ok = await updateHub(hubId, { name: next })
    setSavingName(false)
    if (ok) setEditingName(false)
  }

  if (loading) return <LoadingScreen />

  return (
    <PageTransition>
      {/* Hub header */}
      <div className="bg-white dark:bg-dark-card border-b border-slate-200 dark:border-dark-border">
        <div className="h-1.5 w-full" style={{ backgroundColor: color }} />
        <div className="px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate('/hub')}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors shrink-0"
            >
              <ArrowLeft size={17} />
            </button>
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0 select-none"
              style={{ backgroundColor: color }}
            >
              {hub?.icon || hubName[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              {editingName ? (
                <div className="flex items-center gap-1.5">
                  <input
                    ref={nameInputRef}
                    value={nameDraft}
                    onChange={e => setNameDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveName()
                      if (e.key === 'Escape') setEditingName(false)
                    }}
                    disabled={savingName}
                    maxLength={80}
                    className="form-input text-[16px] font-bold py-1 px-2 min-w-[10rem] max-w-full"
                  />
                  <button
                    type="button"
                    onClick={saveName}
                    disabled={savingName}
                    className="p-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 disabled:opacity-40"
                    title="Save"
                  >
                    <Check size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingName(false)}
                    disabled={savingName}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-dark-hover disabled:opacity-40"
                    title="Cancel"
                  >
                    <XIcon size={15} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 group/name">
                  <h1 className="text-[17px] font-bold text-slate-900 dark:text-white leading-tight truncate">
                    {hubName}
                  </h1>
                  {canRenameHub && (
                    <button
                      type="button"
                      onClick={() => { setNameDraft(hub?.name || ''); setEditingName(true) }}
                      className="p-1 rounded text-slate-300 hover:text-brand-500 dark:text-slate-600 dark:hover:text-brand-400 opacity-0 group-hover/name:opacity-100 transition-opacity"
                      title="Rename hub"
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                </div>
              )}
              {hub?.description && !editingName && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{hub.description}</p>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowMembers(true)}
            className="btn btn-secondary text-xs flex items-center gap-1.5 shrink-0"
          >
            <Users size={13} />
            Members
          </button>
        </div>
      </div>

      {/* 3-column free-flow grid (Basecamp-style). Stacks on mobile.
          One DndContext wraps all three columns so modules drag freely
          across columns. */}
      <div className="p-4 sm:p-6">
        <DndContext
          sensors={sensors}
          collisionDetection={moduleCollisionDetection}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {[0, 1, 2].map(ci => (
              <ModuleColumn
                key={ci}
                columnId={COLUMN_IDS[ci]}
                modules={localColumns[ci] || []}
                hubId={hubId}
                canManage={canRenameHub}
                onRename={renameModule}
                onDelete={(m) => setPendingDelete(m)}
                onExpand={(m) => setExpandedModule(m)}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
            {activeId && (() => {
              const all = [...localColumns[0], ...localColumns[1], ...localColumns[2]]
              const m = all.find(x => x.id === activeId)
              const meta = m && KIND_META[m.kind]
              if (!m || !meta) return null
              return (
                <div className="shadow-elevated rounded-2xl scale-[1.01]">
                  <HubModuleCard title={m.title} icon={meta.icon} color={meta.color} defaultOpen={meta.defaultOpen} />
                </div>
              )
            })()}
          </DragOverlay>
        </DndContext>

        {canRenameHub && (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => setShowAddModule(true)}
              className="btn btn-secondary text-sm px-4 inline-flex items-center gap-1.5"
            >
              <Plus size={14} />
              Add module
            </button>
          </div>
        )}
      </div>

      {expandedModule && (
        <ExpandedModuleModal
          module={expandedModule}
          hubId={hubId}
          kindMeta={KIND_META[expandedModule.kind]}
          onClose={() => setExpandedModule(null)}
        />
      )}

      <AddModuleModal
        isOpen={showAddModule}
        onClose={() => setShowAddModule(false)}
        onSubmit={async ({ kind, title, columnIndex }) => {
          const created = await addModule(kind, title, columnIndex)
          return !!created
        }}
      />

      {pendingDelete && (
        <ConfirmDeleteModule
          module={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            const ok = await deleteModule(pendingDelete.id)
            setPendingDelete(null)
            if (ok) showToast('Module deleted')
          }}
        />
      )}

      <HubMembersPanel
        hubId={hubId}
        isOpen={showMembers}
        onClose={() => setShowMembers(false)}
        myRole={myRole}
      />
    </PageTransition>
  )
}

function ConfirmDeleteModule({ module, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50" onClick={onCancel}>
      <div
        className="bg-white dark:bg-dark-card rounded-2xl shadow-elevated p-5 w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">Delete this module?</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          <strong>{module.title}</strong> and everything inside it will be permanently removed for everyone in this hub. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn btn-ghost text-sm px-4" disabled={busy}>Cancel</button>
          <button
            onClick={async () => { setBusy(true); await onConfirm() }}
            disabled={busy}
            className="btn text-sm px-4 bg-red-500 hover:bg-red-600 text-white"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function HubPage() {
  const { hubId } = useParams()
  const navigate = useNavigate()

  if (hubId) {
    return <HubDashboard hubId={hubId} />
  }

  return <HubList onSelectHub={(id) => navigate(`/hub/${id}`)} />
}
