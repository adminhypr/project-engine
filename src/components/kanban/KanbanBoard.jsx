import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import KanbanColumn from './KanbanColumn'
import KanbanCard from './KanbanCard'
import DistributionBar from './DistributionBar'
import { showToast } from '../ui'

const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Done']

const PRIORITY_RANK = { red: 0, orange: 1, yellow: 2, green: 3, none: 4 }
const URGENCY_RANK = { High: 0, Med: 1, Low: 2 }

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const pr = (PRIORITY_RANK[a.priority] ?? 4) - (PRIORITY_RANK[b.priority] ?? 4)
    if (pr !== 0) return pr
    const ur = (URGENCY_RANK[a.urgency] ?? 1) - (URGENCY_RANK[b.urgency] ?? 1)
    if (ur !== 0) return ur
    if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date)
    if (a.due_date) return -1
    if (b.due_date) return 1
    return 0
  })
}

export default function KanbanBoard({ tasks, updateTask, deleteTask, refetch, onCardClick, onQuickAdd }) {
  const [activeId, setActiveId] = useState(null)
  const [optimisticMoves, setOptimisticMoves] = useState({})

  // Persisted UI state
  const [collapsed, setCollapsed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pe-kanban-collapsed') || '{}') } catch { return {} }
  })
  const [wipLimits, setWipLimits] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pe-kanban-wip') || '{}') } catch { return {} }
  })

  useEffect(() => { localStorage.setItem('pe-kanban-collapsed', JSON.stringify(collapsed)) }, [collapsed])
  useEffect(() => { localStorage.setItem('pe-kanban-wip', JSON.stringify(wipLimits)) }, [wipLimits])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const getEffectiveStatus = useCallback(
    (task) => optimisticMoves[task.id] || task.status,
    [optimisticMoves]
  )

  const columns = useMemo(() => {
    const grouped = {}
    STATUSES.forEach(s => { grouped[s] = [] })
    tasks.forEach(task => {
      const status = getEffectiveStatus(task)
      if (grouped[status]) grouped[status].push(task)
    })
    STATUSES.forEach(s => { grouped[s] = sortTasks(grouped[s]) })
    return grouped
  }, [tasks, getEffectiveStatus])

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null

  function handleDragStart(event) {
    setActiveId(event.active.id)
  }

  function handleDragEnd(event) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return

    const taskId = active.id
    let newStatus = over.id
    if (!STATUSES.includes(newStatus)) {
      const overTask = tasks.find(t => t.id === over.id)
      if (overTask) newStatus = getEffectiveStatus(overTask)
      else return
    }

    const task = tasks.find(t => t.id === taskId)
    if (!task || getEffectiveStatus(task) === newStatus) return

    setOptimisticMoves(prev => ({ ...prev, [taskId]: newStatus }))

    updateTask(taskId, { status: newStatus }).then(result => {
      if (result.ok) {
        showToast(`Moved to ${newStatus}`)
      } else {
        showToast(result.msg || 'Failed to update', 'error')
        setOptimisticMoves(prev => { const n = { ...prev }; delete n[taskId]; return n })
      }
      refetch()
      setTimeout(() => {
        setOptimisticMoves(prev => { const n = { ...prev }; delete n[taskId]; return n })
      }, 1500)
    })
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <DistributionBar columns={columns} />

      <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-4 snap-x snap-mandatory md:snap-none px-4 sm:px-6">
        {STATUSES.map(status => (
          <KanbanColumn
            key={status}
            status={status}
            tasks={columns[status]}
            onCardClick={onCardClick}
            isCollapsed={!!collapsed[status]}
            onToggleCollapse={() => setCollapsed(prev => ({ ...prev, [status]: !prev[status] }))}
            wipLimit={wipLimits[status] || null}
            onSetWipLimit={(limit) => setWipLimits(prev => ({ ...prev, [status]: limit }))}
            onQuickAdd={onQuickAdd}
            onUpdateTask={updateTask}
            onDeleteTask={deleteTask}
            onRefetch={refetch}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
        {activeTask ? <KanbanCard task={activeTask} isDragOverlay /> : null}
      </DragOverlay>
    </DndContext>
  )
}
