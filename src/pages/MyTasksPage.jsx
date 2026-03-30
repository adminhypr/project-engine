import { useState, useEffect, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTasks, useTaskActions, useProfiles } from '../hooks/useTasks'
import { useAuth } from '../hooks/useAuth'
import { applyFilters } from '../lib/filters'
import { PageHeader, StatsStrip, FilterRow, LoadingScreen, EmptyState, showToast } from '../components/ui'
import { PageTransition } from '../components/ui/animations'
import TaskTable from '../components/tasks/TaskTable'
import TaskDetailPanel from '../components/tasks/TaskDetailPanel'
import AcceptanceBanner from '../components/tasks/AcceptanceBanner'
import DeclineModal from '../components/tasks/DeclineModal'
import DeleteConfirmModal from '../components/tasks/DeleteConfirmModal'
import MassActionBar from '../components/tasks/MassActionBar'
import KanbanBoard from '../components/kanban/KanbanBoard'
import QuickAddModal from '../components/kanban/QuickAddModal'
import { List, Columns3 } from 'lucide-react'

const VIEW_KEY = 'pe-task-view'

export default function MyTasksPage() {
  const { profile, isManager } = useAuth()
  const { myTasks, tasks, loading, refetch } = useTasks()
  const { acceptTask, declineTask, deleteTasks, updateTasks, updateTask, deleteTask, assignTask } = useTaskActions()
  const { profiles } = useProfiles()
  const location = useLocation()
  const navigate = useNavigate()
  const [tab, setTab] = useState('mine') // 'mine' | 'assigned'
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'list') // 'list' | 'board'
  const [filters,    setFilters]    = useState({ statuses: ['Not Started', 'In Progress', 'Blocked'] })
  const [activeTask, setActiveTask] = useState(null)
  const [declineTarget, setDeclineTarget] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [quickAddStatus, setQuickAddStatus] = useState(null)

  // Persist view preference
  function switchView(v) {
    setView(v)
    localStorage.setItem(VIEW_KEY, v)
    setSelectedIds(new Set())
  }

  // Tasks I assigned to others (exclude self-assignments)
  const assignedByMe = tasks.filter(t => t.assigned_by === profile?.id && t.assigned_to !== profile?.id)
  const activeTasks = tab === 'mine' ? myTasks : assignedByMe

  // Open task panel from notification click or ?task= query param
  useEffect(() => {
    const openTaskId = location.state?.openTaskId || new URLSearchParams(location.search).get('task')
    if (openTaskId && tasks.length > 0) {
      const task = tasks.find(t => t.id === openTaskId)
      if (task) setActiveTask(task)
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state?.openTaskId, location.search, tasks])

  // Clear selection on tab change
  useEffect(() => { setSelectedIds(new Set()) }, [tab])

  const pendingTasks = myTasks.filter(t => t.acceptance_status === 'Pending')

  // In board view, don't filter by status (columns handle it)
  const effectiveFilters = view === 'board'
    ? (({ statuses, ...rest }) => rest)(filters)
    : filters
  const filtered = applyFilters(activeTasks, effectiveFilters)

  const stats = view === 'board'
    ? [
        { label: 'Not Started', value: filtered.filter(t => t.status === 'Not Started').length, color: 'text-slate-500' },
        { label: 'In Progress', value: filtered.filter(t => t.status === 'In Progress').length, color: 'text-blue-500' },
        { label: 'Blocked',     value: filtered.filter(t => t.status === 'Blocked').length,     color: 'text-red-500' },
        { label: 'Done',        value: filtered.filter(t => t.status === 'Done').length,        color: 'text-emerald-600' },
      ]
    : tab === 'mine'
      ? [
          { label: 'Overdue / Inactive', value: myTasks.filter(t => t.priority === 'red').length,    color: 'text-red-500' },
          { label: 'Urgent',             value: myTasks.filter(t => t.priority === 'orange').length,  color: 'text-orange-500' },
          { label: 'Completed',          value: myTasks.filter(t => t.status === 'Done').length,      color: 'text-emerald-600' },
          { label: 'Total Tasks',        value: myTasks.length,                                        color: 'text-slate-900 dark:text-white' },
        ]
      : [
          { label: 'Pending',            value: assignedByMe.filter(t => t.acceptance_status === 'Pending').length,  color: 'text-yellow-500' },
          { label: 'In Progress',        value: assignedByMe.filter(t => t.status === 'In Progress').length,         color: 'text-blue-500' },
          { label: 'Completed',          value: assignedByMe.filter(t => t.status === 'Done').length,                color: 'text-emerald-600' },
          { label: 'Total Assigned',     value: assignedByMe.length,                                                 color: 'text-slate-900 dark:text-white' },
        ]

  async function handleAccept(task) {
    const result = await acceptTask(task.id)
    if (result.ok) { showToast('Task accepted'); refetch() }
    else showToast(result.msg, 'error')
  }

  async function handleDecline(reason) {
    if (!declineTarget) return
    const result = await declineTask(declineTarget.id, reason)
    if (result.ok) { showToast('Task declined'); refetch() }
    else showToast(result.msg, 'error')
  }

  // Selection handlers
  const handleSelectionChange = useCallback((taskId, isSelected) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      isSelected ? next.add(taskId) : next.delete(taskId)
      return next
    })
  }, [])

  // Clear selection when filters change
  useEffect(() => { setSelectedIds(new Set()) }, [filters])

  async function handleBulkStatusChange(status) {
    const result = await updateTasks([...selectedIds], { status })
    if (result.ok) { showToast(`${selectedIds.size} task(s) updated`); setSelectedIds(new Set()); refetch() }
    else showToast(result.msg, 'error')
  }

  async function handleBulkUrgencyChange(urgency) {
    const result = await updateTasks([...selectedIds], { urgency })
    if (result.ok) { showToast(`${selectedIds.size} task(s) updated`); setSelectedIds(new Set()); refetch() }
    else showToast(result.msg, 'error')
  }

  async function handleBulkDelete() {
    const result = await deleteTasks([...selectedIds])
    if (result.ok) { showToast(`${selectedIds.size} task(s) deleted`); setSelectedIds(new Set()); refetch() }
    else showToast(result.msg, 'error')
  }

  if (loading) return <LoadingScreen />

  // View toggle component
  const viewToggle = (
    <div className="inline-flex rounded-lg bg-slate-100 dark:bg-dark-hover p-0.5 gap-0.5">
      <button
        onClick={() => switchView('list')}
        className={`p-1.5 rounded-md transition-all duration-150 ${
          view === 'list'
            ? 'bg-white dark:bg-dark-card text-slate-900 dark:text-white shadow-soft'
            : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
        }`}
        title="List view"
      >
        <List size={16} />
      </button>
      <button
        onClick={() => switchView('board')}
        className={`p-1.5 rounded-md transition-all duration-150 ${
          view === 'board'
            ? 'bg-white dark:bg-dark-card text-slate-900 dark:text-white shadow-soft'
            : 'text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
        }`}
        title="Board view"
      >
        <Columns3 size={16} />
      </button>
    </div>
  )

  return (
    <PageTransition>
      <div>
        <PageHeader
          title="My Tasks"
          subtitle={tab === 'mine'
            ? `Tasks assigned to ${profile?.full_name}`
            : `Tasks you've assigned to others`
          }
          actions={viewToggle}
        />

        {/* Tab toggle */}
        <div className="px-4 sm:px-6 pt-4 sm:pt-5">
          <div className="inline-flex rounded-xl bg-slate-100 dark:bg-dark-hover p-1 gap-1">
            <button
              onClick={() => setTab('mine')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                tab === 'mine'
                  ? 'bg-white dark:bg-dark-card text-slate-900 dark:text-white shadow-soft'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              Assigned to Me
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-md ${
                tab === 'mine'
                  ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'bg-slate-200/60 text-slate-500 dark:bg-dark-border dark:text-slate-400'
              }`}>
                {myTasks.length}
              </span>
            </button>
            <button
              onClick={() => setTab('assigned')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                tab === 'assigned'
                  ? 'bg-white dark:bg-dark-card text-slate-900 dark:text-white shadow-soft'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              Assigned by Me
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-md ${
                tab === 'assigned'
                  ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
                  : 'bg-slate-200/60 text-slate-500 dark:bg-dark-border dark:text-slate-400'
              }`}>
                {assignedByMe.length}
              </span>
            </button>
          </div>
        </div>

        {tab === 'mine' && <AcceptanceBanner count={pendingTasks.length} />}

        <StatsStrip stats={stats} />

        {view === 'board' ? (
          <>
            {/* Inline filters for board view (no status checkboxes) */}
            <div className="px-4 sm:px-6 pt-4">
              <div className="flex flex-wrap gap-2 items-center">
                <input
                  type="text"
                  placeholder="Search tasks..."
                  value={filters.search || ''}
                  onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                  className="form-input w-full sm:w-44"
                />
                <select
                  value={filters.urgency || ''}
                  onChange={e => setFilters(f => ({ ...f, urgency: e.target.value }))}
                  className="form-input w-[calc(50%-0.25rem)] sm:w-36"
                >
                  <option value="">All urgencies</option>
                  <option>High</option>
                  <option>Med</option>
                  <option>Low</option>
                </select>
                <select
                  value={filters.priority || ''}
                  onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}
                  className="form-input w-[calc(50%-0.25rem)] sm:w-36"
                >
                  <option value="">All priorities</option>
                  <option value="red">Red</option>
                  <option value="orange">Orange</option>
                  <option value="yellow">Yellow</option>
                  <option value="green">Green</option>
                </select>
                <button
                  className="btn-ghost text-xs px-3 py-2"
                  onClick={() => setFilters({})}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="pt-4">
              <KanbanBoard
                tasks={filtered}
                updateTask={updateTask}
                deleteTask={deleteTask}
                refetch={refetch}
                onCardClick={setActiveTask}
                onQuickAdd={setQuickAddStatus}
              />
            </div>
          </>
        ) : (
          <div className="p-4 sm:p-6">
            <div className="card">
              <FilterRow
                filters={filters}
                onChange={(k, v) => setFilters(f => ({ ...f, [k]: v }))}
                onClear={() => setFilters({ statuses: ['Not Started', 'In Progress', 'Blocked'] })}
              />
              <MassActionBar
                selectedCount={filtered.filter(t => selectedIds.has(t.id)).length}
                onSelectAll={() => setSelectedIds(new Set(filtered.map(t => t.id)))}
                onDeselectAll={() => setSelectedIds(new Set())}
                onBulkStatusChange={handleBulkStatusChange}
                onBulkUrgencyChange={handleBulkUrgencyChange}
                onBulkDelete={() => setShowBulkDelete(true)}
              />
              {filtered.length === 0
                ? <EmptyState
                    icon={tab === 'mine' ? '✓' : '📋'}
                    title="No tasks"
                    description={tab === 'mine'
                      ? (Object.keys(filters).length > 1 ? "No tasks match your filters." : "You have no tasks assigned to you yet.")
                      : (Object.keys(filters).length > 1 ? "No tasks match your filters." : "You haven't assigned any tasks to others yet.")}
                  />
                : <TaskTable
                    tasks={filtered}
                    onRowClick={setActiveTask}
                    showAssignedBy={tab === 'mine'}
                    showAssignedTo={tab === 'assigned'}
                    showAcceptanceActions={tab === 'mine'}
                    onAccept={handleAccept}
                    onDecline={task => setDeclineTarget(task)}
                    selectable
                    selectedIds={selectedIds}
                    onSelectionChange={handleSelectionChange}
                  />
              }
            </div>
          </div>
        )}

        {activeTask && (
          <TaskDetailPanel
            task={activeTask}
            onClose={() => setActiveTask(null)}
            onUpdated={() => { refetch(); setActiveTask(null) }}
          />
        )}

        <DeclineModal
          isOpen={!!declineTarget}
          onClose={() => setDeclineTarget(null)}
          onConfirm={handleDecline}
          taskTitle={declineTarget?.title}
        />

        <DeleteConfirmModal
          isOpen={showBulkDelete}
          onClose={() => setShowBulkDelete(false)}
          onConfirm={handleBulkDelete}
          count={selectedIds.size}
        />

        <QuickAddModal
          isOpen={!!quickAddStatus}
          onClose={() => setQuickAddStatus(null)}
          status={quickAddStatus || 'Not Started'}
          profile={profile}
          profiles={profiles}
          assignTask={assignTask}
          updateTask={updateTask}
          refetch={refetch}
        />
      </div>
    </PageTransition>
  )
}
