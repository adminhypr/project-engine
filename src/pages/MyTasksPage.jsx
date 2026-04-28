import { useState, useEffect, useCallback, useRef, Profiler, useMemo } from 'react'
import { logRender } from '../lib/refreshDiagnostic'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTasks, useTaskActions, useProfiles } from '../hooks/useTasks'
import { useAuth } from '../hooks/useAuth'
import { applyFilters } from '../lib/filters'
import { applyHideSubtasksFilter, anyHasSubtasks } from '../lib/subtasks'
import { useRecurrences } from '../hooks/useRecurrences'
import RecurringList from '../components/recurring/RecurringList'
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
  const { templates: recurringTemplates } = useRecurrences()
  const ownedRecurringCount = (recurringTemplates || []).filter(
    t => profile?.role === 'Admin' || t.created_by === profile?.id
  ).length
  const { acceptTask, declineTask, deleteTasks, updateTasks, updateTask, deleteTask, assignTask } = useTaskActions()
  const { profiles } = useProfiles()
  const location = useLocation()
  const navigate = useNavigate()
  const [tab, setTab] = useState(() => {
    // Honor ?tab= from initial URL (the AssignTaskPage redirects with
    // ?tab=recurring after creating a recurring task).
    const params = new URLSearchParams(window.location.search)
    const t = params.get('tab')
    return (t === 'assigned' || t === 'recurring') ? t : 'mine'
  }) // 'mine' | 'assigned' | 'recurring'
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'list') // 'list' | 'board'
  const [filters,    setFilters]    = useState({ statuses: ['Not Started', 'In Progress', 'Blocked'] })
  // Open-task is mirrored to ?task=<id> so it survives navigation away and
  // back. Without this, leaving /my-tasks unmounts the panel and the user
  // loses their place when they return.
  const activeTaskId = useMemo(() => {
    const v = new URLSearchParams(location.search).get('task')
    return v || null
  }, [location.search])
  const setActiveTaskId = useCallback((id) => {
    const params = new URLSearchParams(location.search)
    if (id) params.set('task', id)
    else params.delete('task')
    const next = params.toString()
    navigate({ pathname: location.pathname, search: next ? `?${next}` : '' }, { replace: true })
  }, [location.pathname, location.search, navigate])
  const [declineTarget, setDeclineTarget] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [quickAddStatus, setQuickAddStatus] = useState(null)
  const [hideSubtasks, setHideSubtasks] = useState(false) // off by default on My Tasks

  // Persist view preference
  function switchView(v) {
    setView(v)
    localStorage.setItem(VIEW_KEY, v)
    setSelectedIds(new Set())
  }

  // Derive the live active task from the current tasks array so realtime
  // updates (e.g. per-assignee completion checkboxes) flow into the open panel.
  const activeTask = activeTaskId ? (tasks.find(t => t.id === activeTaskId) ?? null) : null

  // Tasks I assigned to others (exclude self-assignments)
  const assignedByMe = tasks.filter(t => t.assigned_by === profile?.id && t.assigned_to !== profile?.id)
  const activeTasks = tab === 'mine' ? myTasks : assignedByMe

  // Two sources of "open this task":
  //   • location.state.openTaskId — pushed by NotificationBell when the user
  //     clicks a notification from another page. We mirror it into the URL
  //     so subsequent navigation preserves the panel.
  //   • ?task= query param — already wired into activeTaskId above. The only
  //     thing we need to handle here is the human-readable task_id form
  //     (e.g. PED-123) used by chat-card links: rewrite to the DB uuid so
  //     the panel keeps working after a refresh.
  // When the target task isn't in the already-loaded tasks array, trigger
  // one silent refetch so we don't need a hard page reload to pick it up.
  const refetchedForIdsRef = useRef(new Set())
  useEffect(() => {
    const stateOpenId = location.state?.openTaskId
    if (stateOpenId) {
      setActiveTaskId(stateOpenId)
      navigate(location.pathname + location.search, { replace: true, state: {} })
      return
    }
    if (!activeTaskId) return
    if (tasks.length === 0) return
    const task = tasks.find(t => t.id === activeTaskId || t.task_id === activeTaskId)
    if (task && task.id !== activeTaskId) {
      // URL had the human-readable task_id; rewrite to the uuid.
      setActiveTaskId(task.id)
      return
    }
    if (!task && !refetchedForIdsRef.current.has(activeTaskId)) {
      refetchedForIdsRef.current.add(activeTaskId)
      refetch(true)
    }
  }, [location.state?.openTaskId, location.pathname, location.search, activeTaskId, tasks, refetch, setActiveTaskId, navigate])

  // Listen for the chat widget's "Open task →" link. The header dispatches a
  // window-level open-task CustomEvent with { taskId }; we set activeTaskId so
  // the detail panel opens on top of the current page.
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.taskId) setActiveTaskId(e.detail.taskId)
    }
    window.addEventListener('open-task', handler)
    return () => window.removeEventListener('open-task', handler)
  }, [])

  // Clear selection on tab change
  useEffect(() => { setSelectedIds(new Set()) }, [tab])

  const pendingTasks = myTasks.filter(t => t.acceptance_status === 'Pending')

  // In board view, don't filter by status (columns handle it)
  const effectiveFilters = view === 'board'
    ? (({ statuses, ...rest }) => rest)(filters)
    : filters
  const filtered = applyHideSubtasksFilter(applyFilters(activeTasks, effectiveFilters), hideSubtasks)
  const showSubtaskToggle = anyHasSubtasks(activeTasks)

  const mineRedOverdue = filtered.filter(t => t.priority === 'red' && t.due_date && new Date(t.due_date) < new Date()).length
  const mineRedInactive = filtered.filter(t => t.priority === 'red' && (!t.due_date || new Date(t.due_date) >= new Date())).length

  const stats = view === 'board'
    ? [
        { label: 'Not Started', value: filtered.filter(t => t.status === 'Not Started').length, color: 'text-slate-500' },
        { label: 'In Progress', value: filtered.filter(t => t.status === 'In Progress').length, color: 'text-blue-500' },
        { label: 'Blocked',     value: filtered.filter(t => t.status === 'Blocked').length,     color: 'text-red-500' },
        { label: 'Done',        value: filtered.filter(t => t.status === 'Done').length,        color: 'text-emerald-600' },
      ]
    : tab === 'mine'
      ? [
          { label: 'Overdue / Inactive', value: filtered.filter(t => t.priority === 'red').length, color: 'text-red-500',
            detail: `${mineRedOverdue} overdue (past due date)\n${mineRedInactive} inactive (no updates 36h+)` },
          { label: 'Urgent',             value: filtered.filter(t => t.priority === 'orange').length, color: 'text-orange-500',
            detail: 'Due within the next 12 hours' },
          { label: 'Completed',          value: filtered.filter(t => t.status === 'Done').length, color: 'text-emerald-600' },
          { label: 'Total Tasks',        value: filtered.length, color: 'text-slate-900 dark:text-white',
            detail: `${filtered.filter(t => t.status === 'Not Started').length} not started · ${filtered.filter(t => t.status === 'In Progress').length} in progress · ${filtered.filter(t => t.status === 'Blocked').length} blocked` },
        ]
      : [
          { label: 'Pending',            value: filtered.filter(t => t.acceptance_status === 'Pending').length, color: 'text-yellow-500',
            detail: 'Awaiting acceptance from assignee' },
          { label: 'In Progress',        value: filtered.filter(t => t.status === 'In Progress').length, color: 'text-blue-500' },
          { label: 'Completed',          value: filtered.filter(t => t.status === 'Done').length, color: 'text-emerald-600' },
          { label: 'Total Assigned',     value: filtered.length, color: 'text-slate-900 dark:text-white',
            detail: `${filtered.filter(t => t.status === 'Not Started').length} not started · ${filtered.filter(t => t.status === 'In Progress').length} in progress · ${filtered.filter(t => t.status === 'Done').length} done` },
        ]

  async function handleAccept(task) {
    const result = await acceptTask(task.id)
    if (result.ok) { showToast('Task accepted'); refetch(true) }
    else showToast(result.msg, 'error')
  }

  async function handleDecline(reason) {
    if (!declineTarget) return
    const result = await declineTask(declineTarget.id, reason)
    if (result.ok) { showToast('Task declined'); refetch(true) }
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
    if (result.ok) { showToast(`${selectedIds.size} task(s) updated`); setSelectedIds(new Set()); refetch(true) }
    else showToast(result.msg, 'error')
  }

  async function handleBulkUrgencyChange(urgency) {
    const result = await updateTasks([...selectedIds], { urgency })
    if (result.ok) { showToast(`${selectedIds.size} task(s) updated`); setSelectedIds(new Set()); refetch(true) }
    else showToast(result.msg, 'error')
  }

  async function handleBulkDelete() {
    const result = await deleteTasks([...selectedIds])
    if (result.ok) { showToast(`${selectedIds.size} task(s) deleted`); setSelectedIds(new Set()); refetch(true) }
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
            {ownedRecurringCount > 0 && (
              <button
                onClick={() => setTab('recurring')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
                  tab === 'recurring'
                    ? 'bg-white dark:bg-dark-card text-slate-900 dark:text-white shadow-soft'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                Recurring
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-md ${
                  tab === 'recurring'
                    ? 'bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300'
                    : 'bg-slate-200/60 text-slate-500 dark:bg-dark-border dark:text-slate-400'
                }`}>
                  {ownedRecurringCount}
                </span>
              </button>
            )}
          </div>
        </div>

        {tab === 'mine' && <AcceptanceBanner count={pendingTasks.length} />}

        {tab === 'recurring' ? (
          <div className="p-4 sm:p-6">
            <RecurringList />
          </div>
        ) : (
        <>
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
                onCardClick={(t) => setActiveTaskId(t.id)}
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
              {showSubtaskToggle && (
                <div className="px-4 sm:px-5 py-2 border-b border-slate-100 dark:border-dark-border">
                  <button
                    type="button"
                    onClick={() => setHideSubtasks(v => !v)}
                    className={`text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
                      hideSubtasks
                        ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-dark-hover dark:text-slate-300'
                    }`}
                    aria-pressed={hideSubtasks}
                  >
                    {hideSubtasks ? '✓ Hiding sub-tasks' : 'Hide sub-tasks'}
                  </button>
                </div>
              )}
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
                    onRowClick={(t) => setActiveTaskId(t.id)}
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
        </>
        )}

        {activeTask && (
          <Profiler id="TaskDetailPanel" onRender={logRender}>
            <TaskDetailPanel
              task={activeTask}
              tasks={tasks}
              onClose={() => setActiveTaskId(null)}
              onUpdated={() => { refetch(true); setActiveTaskId(null) }}
            />
          </Profiler>
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
