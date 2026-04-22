import { useEffect, useState, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { DndContext, DragOverlay, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { useHubs } from '../hooks/useHubs'
import { useAuth } from '../hooks/useAuth'
import { showToast } from '../components/ui'
import { useHubModuleOrder } from '../hooks/useHubModuleOrder'
import { PageTransition } from '../components/ui/animations'
import { LoadingScreen } from '../components/ui/index'
import HubList from '../components/hub/HubList'
import HubModuleCard from '../components/hub/HubModuleCard'
import SortableModuleCard from '../components/hub/SortableModuleCard'
import HubMembersPanel from '../components/hub/HubMembersPanel'
import ActivityFeed from '../components/hub/ActivityFeed'
import Attendance from '../components/hub/Attendance'
import Campfire from '../components/hub/Campfire'
import MessageBoard from '../components/hub/MessageBoard'
import CheckIns from '../components/hub/CheckIns'
import Schedule from '../components/hub/Schedule'
import DocsFiles from '../components/hub/DocsFiles'
import TodosModuleCard from '../components/hub/todos/TodosModuleCard'
import {
  Activity, Users, Flame, MessageSquare, ClipboardCheck,
  Calendar, FolderOpen, ArrowLeft, CheckSquare, Pencil, Check, X as XIcon
} from 'lucide-react'

const DEFAULT_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

const MODULE_DEFS = {
  'message-board': { title: 'Message Board', icon: MessageSquare, color: '#7c3aed', defaultOpen: true },
  'to-dos':        { title: 'To-Dos',        icon: CheckSquare,    color: '#8b5cf6', defaultOpen: true },
  'check-ins':     { title: 'Check-ins',     icon: ClipboardCheck, color: '#059669', defaultOpen: true },
  'schedule':      { title: 'Schedule',       icon: Calendar,       color: '#d97706', defaultOpen: false },
  'docs-files':    { title: 'Docs & Files',   icon: FolderOpen,     color: '#0284c7', defaultOpen: false },
  'campfire':      { title: 'Campfire',       icon: Flame,          color: '#dc2626', defaultOpen: true },
  'whos-here':     { title: "Who's Here",     icon: Users,          color: '#8b5cf6', defaultOpen: true },
  'activity':      { title: 'Activity',       icon: Activity,       color: '#64748b', defaultOpen: false },
}

const MODULE_COMPONENTS = {
  'message-board': MessageBoard,
  'to-dos':        TodosModuleCard,
  'check-ins':     CheckIns,
  'schedule':      Schedule,
  'docs-files':    DocsFiles,
  'campfire':      Campfire,
  'whos-here':     Attendance,
  'activity':      ActivityFeed,
}

function SortableColumn({ columnKey, items, moduleOrder, saveModuleOrder, hubId, sensors, activeId, setActiveId }) {
  function handleDragEnd({ active, over }) {
    setActiveId(null)
    if (!over || active.id === over.id) return
    const oldOrder = moduleOrder[columnKey]
    const oldIdx = oldOrder.indexOf(active.id)
    const newIdx = oldOrder.indexOf(over.id)
    if (oldIdx === -1 || newIdx === -1) return
    saveModuleOrder({ ...moduleOrder, [columnKey]: arrayMove(oldOrder, oldIdx, newIdx) })
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }) => setActiveId(active.id)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {items.map(id => {
          const def = MODULE_DEFS[id]
          const Comp = MODULE_COMPONENTS[id]
          if (!def || !Comp) return null
          return (
            <SortableModuleCard key={id} id={id} title={def.title} icon={def.icon} color={def.color} defaultOpen={def.defaultOpen}>
              <Comp hubId={hubId} />
            </SortableModuleCard>
          )
        })}
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'ease' }}>
        {activeId && MODULE_DEFS[activeId] && (
          <div className="shadow-elevated rounded-2xl scale-[1.01]">
            <HubModuleCard {...MODULE_DEFS[activeId]} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

function HubDashboard({ hubId }) {
  const { hubs, loading, updateHub } = useHubs()
  const { isAdmin } = useAuth()
  const { moduleOrder, saveModuleOrder } = useHubModuleOrder(hubId)
  const navigate = useNavigate()
  const [showMembers, setShowMembers] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)
  const nameInputRef = useRef(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  )

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

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row">
        {/* Left — main work tools */}
        <div className="flex-1 min-w-0 p-4 sm:p-6 space-y-4">
          <SortableColumn
            columnKey="left"
            items={moduleOrder.left}
            moduleOrder={moduleOrder}
            saveModuleOrder={saveModuleOrder}
            hubId={hubId}
            sensors={sensors}
            activeId={activeId}
            setActiveId={setActiveId}
          />
        </div>

        {/* Right sidebar — chat, presence, activity */}
        <div className="w-full lg:w-80 xl:w-96 shrink-0 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-dark-border p-4 space-y-4">
          <SortableColumn
            columnKey="sidebar"
            items={moduleOrder.sidebar}
            moduleOrder={moduleOrder}
            saveModuleOrder={saveModuleOrder}
            hubId={hubId}
            sensors={sensors}
            activeId={activeId}
            setActiveId={setActiveId}
          />
        </div>
      </div>

      <HubMembersPanel
        hubId={hubId}
        isOpen={showMembers}
        onClose={() => setShowMembers(false)}
        myRole={myRole}
      />
    </PageTransition>
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
