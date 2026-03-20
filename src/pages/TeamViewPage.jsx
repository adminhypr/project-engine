import { useState } from 'react'
import { useTasks } from '../hooks/useTasks'
import { useAuth } from '../hooks/useAuth'
import { applyFilters } from '../lib/filters'
import { PageHeader, StatsStrip, FilterRow, LoadingScreen, EmptyState } from '../components/ui'
import { PageTransition } from '../components/ui/animations'
import TaskTable from '../components/tasks/TaskTable'
import TaskDetailPanel from '../components/tasks/TaskDetailPanel'

const TEAM_COLORS = [
  'border-l-4 border-l-orange-500 bg-orange-500/8 backdrop-blur-sm',
  'border-l-4 border-l-sky-500 bg-sky-500/8 backdrop-blur-sm',
  'border-l-4 border-l-emerald-500 bg-emerald-500/8 backdrop-blur-sm',
  'border-l-4 border-l-purple-500 bg-purple-500/8 backdrop-blur-sm',
  'border-l-4 border-l-pink-500 bg-pink-500/8 backdrop-blur-sm',
  'border-l-4 border-l-navy-500 bg-navy-500/8 backdrop-blur-sm',
]

export default function TeamViewPage() {
  const { profile, isAdmin } = useAuth()
  const { tasks, teamTasks, loading, refetch } = useTasks()
  const [filters,    setFilters]    = useState({})
  const [activeTask, setActiveTask] = useState(null)

  const viewTasks  = isAdmin ? tasks : teamTasks
  const filtered   = applyFilters(viewTasks, filters)

  const grouped = filtered.reduce((acc, t) => {
    const key = t.team?.name || 'No Team'
    if (!acc[key]) acc[key] = []
    acc[key].push(t)
    return acc
  }, {})

  const allTeams = [...new Map(viewTasks.map(t => [t.team_id, t.team])).values()].filter(Boolean)

  const stats = [
    { label: 'Red',        value: viewTasks.filter(t => t.priority === 'red').length,    color: 'text-red-500' },
    { label: 'In Progress',value: viewTasks.filter(t => t.status === 'In Progress').length, color: 'text-sky-600' },
    { label: 'Blocked',    value: viewTasks.filter(t => t.status === 'Blocked').length,  color: 'text-red-600' },
    { label: 'Total',      value: viewTasks.length,                                       color: 'text-navy-900' },
  ]

  if (loading) return <LoadingScreen />

  return (
    <PageTransition>
      <div>
        <PageHeader
          title={isAdmin ? 'All Teams Overview' : `${profile?.teams?.name || 'Team'} View`}
          subtitle={isAdmin ? 'All tasks across all teams' : 'All tasks for your team'}
        />

        <StatsStrip stats={stats} />

        <div className="p-6">
          <div className="card">
            <FilterRow
              filters={filters}
              onChange={(k, v) => setFilters(f => ({ ...f, [k]: v }))}
              onClear={() => setFilters({})}
              showTeamFilter={isAdmin}
              teams={allTeams}
            />

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
                              <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider px-4 py-1.5">
                                {group.name ? `Reports to ${group.name}` : 'No reporting manager'}
                                <span className="ml-1.5 text-navy-300">({group.tasks.length})</span>
                              </p>
                              <TaskTable
                                tasks={group.tasks}
                                onRowClick={setActiveTask}
                                showAssignedTo
                                showAssignedBy
                              />
                            </div>
                          ))
                        : <TaskTable
                            tasks={teamTasks}
                            onRowClick={setActiveTask}
                            showAssignedTo
                            showAssignedBy
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
      </div>
    </PageTransition>
  )
}
