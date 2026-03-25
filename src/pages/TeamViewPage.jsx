import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useTasks, useTaskActions } from '../hooks/useTasks'
import { useAuth } from '../hooks/useAuth'
import { applyFilters } from '../lib/filters'
import { PageHeader, StatsStrip, FilterRow, LoadingScreen, EmptyState, showToast } from '../components/ui'
import { PageTransition } from '../components/ui/animations'
import TaskTable from '../components/tasks/TaskTable'
import TaskDetailPanel from '../components/tasks/TaskDetailPanel'
import MassActionBar from '../components/tasks/MassActionBar'
import DeleteConfirmModal from '../components/tasks/DeleteConfirmModal'
import { Bookmark, X } from 'lucide-react'

const SAVED_VIEW_KEY = 'pe-team-view-filters'

function loadSavedFilters() {
  try {
    const saved = localStorage.getItem(SAVED_VIEW_KEY)
    return saved ? JSON.parse(saved) : null
  } catch { return null }
}

const TEAM_COLORS = [
  'border-l-4 border-l-orange-500 bg-orange-50 dark:bg-orange-500/10 dark:text-orange-300',
  'border-l-4 border-l-sky-500 bg-sky-50 dark:bg-sky-500/10 dark:text-sky-300',
  'border-l-4 border-l-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 dark:text-emerald-300',
  'border-l-4 border-l-purple-500 bg-purple-50 dark:bg-purple-500/10 dark:text-purple-300',
  'border-l-4 border-l-pink-500 bg-pink-50 dark:bg-pink-500/10 dark:text-pink-300',
  'border-l-4 border-l-slate-500 bg-slate-50 dark:bg-slate-500/10 dark:text-slate-300',
]

export default function TeamViewPage() {
  const { profile, isAdmin } = useAuth()
  const { tasks, teamTasks, loading, refetch } = useTasks()
  const { deleteTasks, updateTasks } = useTaskActions()
  const [filters,    setFilters]    = useState(() => loadSavedFilters() || {})
  const [activeTask, setActiveTask] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)

  const savedFilters = loadSavedFilters()
  const hasFilters = Object.keys(filters).some(k => {
    const v = filters[k]
    return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
  })
  const isSaved = savedFilters && JSON.stringify(savedFilters) === JSON.stringify(filters)

  function saveView() {
    localStorage.setItem(SAVED_VIEW_KEY, JSON.stringify(filters))
    showToast('Default view saved')
  }

  function clearSavedView() {
    localStorage.removeItem(SAVED_VIEW_KEY)
    setFilters({})
    showToast('Default view cleared')
  }

  const viewTasks  = isAdmin ? tasks : teamTasks
  const filtered   = applyFilters(viewTasks, filters)

  const grouped = filtered.reduce((acc, t) => {
    const key = t.team?.name || 'No Team'
    if (!acc[key]) acc[key] = []
    acc[key].push(t)
    return acc
  }, {})

  const allTeams = [...new Map(viewTasks.map(t => [t.team_id, t.team])).values()].filter(Boolean)

  // Selection handlers (admin only)
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

  const stats = [
    { label: 'Red',        value: viewTasks.filter(t => t.priority === 'red').length,    color: 'text-red-500' },
    { label: 'In Progress',value: viewTasks.filter(t => t.status === 'In Progress').length, color: 'text-sky-600' },
    { label: 'Blocked',    value: viewTasks.filter(t => t.status === 'Blocked').length,  color: 'text-red-600' },
    { label: 'Total',      value: viewTasks.length,                                       color: 'text-slate-900 dark:text-white' },
  ]

  if (loading) return <LoadingScreen />

  return (
    <PageTransition>
      <div>
        <PageHeader
          title={isAdmin ? 'All Teams Overview' : (
            profile?.all_teams?.length > 1
              ? `${profile.all_teams.map(t => t.name).join(' & ')} View`
              : `${profile?.teams?.name || 'Team'} View`
          )}
          subtitle={isAdmin ? 'All tasks across all teams' : (
            profile?.all_teams?.length > 1
              ? `Tasks across your ${profile.all_teams.length} teams`
              : 'All tasks for your team'
          )}
        />

        <StatsStrip stats={stats} />

        <div className="p-4 sm:p-6">
          <div className="card">
            <div className="flex items-start gap-2">
              <div className="flex-1">
                <FilterRow
                  filters={filters}
                  onChange={(k, v) => setFilters(f => ({ ...f, [k]: v }))}
                  onClear={() => setFilters({})}
                  showTeamFilter={isAdmin}
                  teams={allTeams}
                />
              </div>
              {hasFilters && (
                <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                  <motion.button
                    onClick={saveView}
                    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all
                      ${isSaved
                        ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300'
                        : 'bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:bg-dark-hover dark:text-slate-300 dark:hover:bg-brand-500/15 dark:hover:text-brand-300'
                      }`}
                    whileTap={{ scale: 0.95 }}
                    title={isSaved ? 'This is your saved default view' : 'Save current filters as default view'}
                  >
                    <Bookmark size={12} className={isSaved ? 'fill-current' : ''} />
                    {isSaved ? 'Saved' : 'Save view'}
                  </motion.button>
                  {savedFilters && (
                    <button
                      onClick={clearSavedView}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                      title="Clear saved default view"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              )}
              {!hasFilters && savedFilters && (
                <button
                  onClick={clearSavedView}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
                  title="Clear saved default view"
                >
                  <Bookmark size={12} className="fill-current" />
                  Clear default
                </button>
              )}
            </div>

            {isAdmin && (
              <MassActionBar
                selectedCount={filtered.filter(t => selectedIds.has(t.id)).length}
                onSelectAll={() => setSelectedIds(new Set(filtered.map(t => t.id)))}
                onDeselectAll={() => setSelectedIds(new Set())}
                onBulkStatusChange={handleBulkStatusChange}
                onBulkUrgencyChange={handleBulkUrgencyChange}
                onBulkDelete={() => setShowBulkDelete(true)}
              />
            )}

            {Object.keys(grouped).length === 0
              ? <EmptyState icon="◈" title="No tasks" description="No tasks match your filters." />
              : Object.entries(grouped).map(([teamName, teamTasks], idx) => {
                  // Sub-group by reporting manager within each team
                  const byManager = teamTasks.reduce((acc, t) => {
                    const mgr = t.assignee?.manager?.full_name || null
                    const key = mgr || '_unassigned'
                    if (!acc[key]) acc[key] = { name: mgr, tasks: [] }
                    acc[key].tasks.push(t)
                    return acc
                  }, {})
                  const managerGroups = Object.values(byManager)
                  const hasManagers = managerGroups.some(g => g.name)

                  return (
                    <div key={teamName} className="mb-6">
                      <div className={`px-4 py-2 rounded-xl mb-2 font-semibold text-sm ${TEAM_COLORS[idx % TEAM_COLORS.length]}`}>
                        {teamName} — {teamTasks.length} task{teamTasks.length !== 1 ? 's' : ''}
                      </div>
                      {hasManagers
                        ? managerGroups.map(group => (
                            <div key={group.name || '_unassigned'} className="mb-3">
                              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider px-4 py-1.5">
                                {group.name ? `Reports to ${group.name}` : 'No reporting manager'}
                                <span className="ml-1.5 text-slate-300 dark:text-slate-600">({group.tasks.length})</span>
                              </p>
                              <TaskTable
                                tasks={group.tasks}
                                onRowClick={setActiveTask}
                                showAssignedTo
                                showAssignedBy
                                selectable={isAdmin}
                                selectedIds={selectedIds}
                                onSelectionChange={handleSelectionChange}
                              />
                            </div>
                          ))
                        : <TaskTable
                            tasks={teamTasks}
                            onRowClick={setActiveTask}
                            showAssignedTo
                            showAssignedBy
                            selectable={isAdmin}
                            selectedIds={selectedIds}
                            onSelectionChange={handleSelectionChange}
                          />
                      }
                    </div>
                  )
                })
            }
          </div>
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
      </div>
    </PageTransition>
  )
}
