import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useTasks, useTaskActions, useProfiles } from '../hooks/useTasks'
import { useAuth } from '../hooks/useAuth'
import { applyFilters } from '../lib/filters'
import { PageHeader, StatsStrip, FilterRow, LoadingScreen, EmptyState, showToast } from '../components/ui'
import { PageTransition } from '../components/ui/animations'
import TaskTable from '../components/tasks/TaskTable'
import TaskDetailPanel from '../components/tasks/TaskDetailPanel'
import DeleteConfirmModal from '../components/tasks/DeleteConfirmModal'
import MassActionBar from '../components/tasks/MassActionBar'
import KanbanBoard from '../components/kanban/KanbanBoard'
import QuickAddModal from '../components/kanban/QuickAddModal'
import { List, Columns3 } from 'lucide-react'

const VIEW_KEY = 'pe-admin-view-mode'

export default function AdminOverviewPage() {
  const { profile } = useAuth()
  const { tasks, loading, refetch } = useTasks()
  const { deleteTasks, updateTasks, updateTask, deleteTask, assignTask } = useTaskActions()
  const { profiles } = useProfiles()
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'list')
  const [filters, setFilters] = useState({})
  const [activeTask, setActiveTask] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [quickAddStatus, setQuickAddStatus] = useState(null)
  const [sidebarTeamFilter, setSidebarTeamFilter] = useState(null)

  function switchView(v) {
    setView(v)
    localStorage.setItem(VIEW_KEY, v)
    setSelectedIds(new Set())
    setSidebarTeamFilter(null)
  }

  const allTeams = [...new Map(tasks.map(t => [t.team_id, t.team])).values()].filter(Boolean)

  // Team breakdown keyed by team_id for sidebar interactivity
  const teamBreakdown = Object.entries(
    tasks.reduce((acc, t) => {
      const id = t.team_id || 'none'
      const name = t.team?.name || 'No Team'
      if (!acc[id]) acc[id] = { name, total: 0, red: 0, done: 0, blocked: 0 }
      acc[id].total++
      if (t.priority === 'red')    acc[id].red++
      if (t.status === 'Done')     acc[id].done++
      if (t.status === 'Blocked')  acc[id].blocked++
      return acc
    }, {})
  ).sort((a, b) => b[1].total - a[1].total)

  // In board mode: pre-filter by sidebar team, strip status+team from filters
  const boardTasks = view === 'board' && sidebarTeamFilter
    ? tasks.filter(t => t.team_id === sidebarTeamFilter)
    : tasks
  const effectiveFilters = view === 'board'
    ? (({ statuses, team, ...rest }) => rest)(filters)
    : filters
  const filtered = applyFilters(view === 'board' ? boardTasks : tasks, effectiveFilters)

  const selectedTeamName = sidebarTeamFilter
    ? teamBreakdown.find(([id]) => id === sidebarTeamFilter)?.[1]?.name || 'Selected team'
    : null

  const adminRedOverdue = filtered.filter(t => t.priority === 'red' && t.due_date && new Date(t.due_date) < new Date()).length
  const adminRedInactive = filtered.filter(t => t.priority === 'red' && (!t.due_date || new Date(t.due_date) >= new Date())).length

  const stats = view === 'board'
    ? [
        { label: 'Not Started', value: filtered.filter(t => t.status === 'Not Started').length, color: 'text-slate-500' },
        { label: 'In Progress', value: filtered.filter(t => t.status === 'In Progress').length, color: 'text-blue-500' },
        { label: 'Blocked',     value: filtered.filter(t => t.status === 'Blocked').length,     color: 'text-red-500' },
        { label: 'Done',        value: filtered.filter(t => t.status === 'Done').length,        color: 'text-emerald-600' },
      ]
    : [
        { label: 'Overdue / Inactive', value: filtered.filter(t => t.priority === 'red').length, color: 'text-red-500',
          detail: `${adminRedOverdue} overdue (past due date)\n${adminRedInactive} inactive (no updates 36h+)` },
        { label: 'Urgent',        value: filtered.filter(t => t.priority === 'orange').length, color: 'text-orange-500',
          detail: 'Due within the next 12 hours' },
        { label: 'Completed',     value: filtered.filter(t => t.status === 'Done').length, color: 'text-emerald-600' },
        { label: 'Total Tasks',   value: filtered.length, color: 'text-slate-900 dark:text-white',
          detail: `${filtered.filter(t => t.status === 'Not Started').length} not started · ${filtered.filter(t => t.status === 'In Progress').length} in progress · ${filtered.filter(t => t.status === 'Blocked').length} blocked` },
      ]

  const handleSelectionChange = useCallback((taskId, isSelected) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      isSelected ? next.add(taskId) : next.delete(taskId)
      return next
    })
  }, [])

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
          title="Admin Overview"
          subtitle={view === 'board' && selectedTeamName ? `Board — ${selectedTeamName}` : 'All tasks across the organization'}
          actions={viewToggle}
        />

        <StatsStrip stats={stats} />

        <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">

          {/* Team breakdown sidebar */}
          <motion.div
            className="card self-start"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
          >
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
              {view === 'board' ? 'Filter by Team' : 'By Team'}
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th text-left py-2 px-2">Team</th>
                  <th className="table-th text-center py-2 px-2">Total</th>
                  <th className="table-th text-center py-2 px-2 text-red-500">Red</th>
                  <th className="table-th text-center py-2 px-2 text-emerald-600">Done</th>
                </tr>
              </thead>
              <tbody>
                {/* All Teams row (board mode only) */}
                {view === 'board' && (
                  <tr
                    onClick={() => setSidebarTeamFilter(null)}
                    className={`border-b border-slate-100 dark:border-dark-border cursor-pointer transition-colors
                      ${!sidebarTeamFilter
                        ? 'bg-brand-50 dark:bg-brand-500/10 font-semibold'
                        : 'hover:bg-slate-50 dark:hover:bg-dark-hover'
                      }`}
                  >
                    <td className="py-2 px-2 text-brand-600 dark:text-brand-300">All Teams</td>
                    <td className="py-2 px-2 text-center">{tasks.length}</td>
                    <td className={`py-2 px-2 text-center font-semibold ${tasks.filter(t => t.priority === 'red').length > 0 ? 'text-red-500' : 'text-slate-400 dark:text-slate-500'}`}>
                      {tasks.filter(t => t.priority === 'red').length}
                    </td>
                    <td className="py-2 px-2 text-center text-emerald-600">{tasks.filter(t => t.status === 'Done').length}</td>
                  </tr>
                )}
                {teamBreakdown.map(([teamId, s]) => (
                  <tr
                    key={teamId}
                    onClick={view === 'board' ? () => setSidebarTeamFilter(teamId) : undefined}
                    className={`border-b border-slate-100 dark:border-dark-border last:border-0
                      ${view === 'board'
                        ? `cursor-pointer transition-colors ${sidebarTeamFilter === teamId
                            ? 'bg-brand-50 dark:bg-brand-500/10 font-semibold'
                            : 'hover:bg-slate-50 dark:hover:bg-dark-hover'
                          }`
                        : ''
                      }`}
                  >
                    <td className="py-2 px-2 font-medium">{s.name}</td>
                    <td className="py-2 px-2 text-center">{s.total}</td>
                    <td className={`py-2 px-2 text-center font-semibold ${s.red > 0 ? 'text-red-500' : 'text-slate-400 dark:text-slate-500'}`}>{s.red}</td>
                    <td className="py-2 px-2 text-center text-emerald-600">{s.done}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>

          {/* Main content */}
          {view === 'board' ? (
            <div>
              <div className="flex flex-wrap gap-2 items-center mb-3">
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
                <button className="btn-ghost text-xs px-3 py-2" onClick={() => { setFilters({}); setSidebarTeamFilter(null) }}>Clear</button>
              </div>
              <KanbanBoard
                tasks={filtered}
                updateTask={updateTask}
                deleteTask={deleteTask}
                refetch={refetch}
                onCardClick={setActiveTask}
                onQuickAdd={setQuickAddStatus}
              />
            </div>
          ) : (
            <div className="card">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">All Tasks</p>
              <FilterRow
                filters={filters}
                onChange={(k, v) => setFilters(f => ({ ...f, [k]: v }))}
                onClear={() => setFilters({})}
                showTeamFilter
                teams={allTeams}
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
                ? <EmptyState icon="⊞" title="No tasks" description="No tasks match your filters." />
                : <TaskTable
                    tasks={filtered}
                    onRowClick={setActiveTask}
                    showAssignedTo
                    showAssignedBy
                    selectable
                    selectedIds={selectedIds}
                    onSelectionChange={handleSelectionChange}
                  />
              }
            </div>
          )}
        </div>

        {activeTask && (
          <TaskDetailPanel
            task={activeTask}
            onClose={() => setActiveTask(null)}
            onUpdated={() => { refetch(); setActiveTask(null) }}
          />
        )}

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
