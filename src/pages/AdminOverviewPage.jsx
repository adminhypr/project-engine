import { useState } from 'react'
import { motion } from 'framer-motion'
import { useTasks } from '../hooks/useTasks'
import { applyFilters } from '../lib/filters'
import { PageHeader, StatsStrip, FilterRow, LoadingScreen, EmptyState } from '../components/ui'
import { PageTransition } from '../components/ui/animations'
import TaskTable from '../components/tasks/TaskTable'
import TaskDetailPanel from '../components/tasks/TaskDetailPanel'

export default function AdminOverviewPage() {
  const { tasks, loading, refetch } = useTasks()
  const [filters,    setFilters]    = useState({})
  const [activeTask, setActiveTask] = useState(null)

  const filtered = applyFilters(tasks, filters)
  const allTeams = [...new Map(tasks.map(t => [t.team_id, t.team])).values()].filter(Boolean)

  const teamBreakdown = Object.entries(
    tasks.reduce((acc, t) => {
      const name = t.team?.name || 'No Team'
      if (!acc[name]) acc[name] = { total: 0, red: 0, done: 0, blocked: 0 }
      acc[name].total++
      if (t.priority === 'red')    acc[name].red++
      if (t.status === 'Done')     acc[name].done++
      if (t.status === 'Blocked')  acc[name].blocked++
      return acc
    }, {})
  ).sort((a, b) => b[1].total - a[1].total)

  const stats = [
    { label: 'Red Org-wide',  value: tasks.filter(t => t.priority === 'red').length,    color: 'text-red-500' },
    { label: 'Urgent',        value: tasks.filter(t => t.priority === 'orange').length,  color: 'text-orange-500' },
    { label: 'Completed',     value: tasks.filter(t => t.status === 'Done').length,      color: 'text-emerald-600' },
    { label: 'Total Tasks',   value: tasks.length,                                        color: 'text-navy-900' },
  ]

  if (loading) return <LoadingScreen />

  return (
    <PageTransition>
      <div>
        <PageHeader title="Admin Overview" subtitle="All tasks across the organization" />

        <StatsStrip stats={stats} />

        <div className="p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">

          {/* Team breakdown */}
          <motion.div
            className="card self-start"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
          >
            <p className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-3">By Team</p>
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
                {teamBreakdown.map(([name, s]) => (
                  <tr key={name} className="border-b border-navy-100/20 last:border-0">
                    <td className="py-2 px-2 font-medium">{name}</td>
                    <td className="py-2 px-2 text-center">{s.total}</td>
                    <td className={`py-2 px-2 text-center font-semibold ${s.red > 0 ? 'text-red-500' : 'text-navy-400'}`}>{s.red}</td>
                    <td className="py-2 px-2 text-center text-emerald-600">{s.done}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>

          {/* Full task list */}
          <div className="card">
            <p className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-3">All Tasks</p>
            <FilterRow
              filters={filters}
              onChange={(k, v) => setFilters(f => ({ ...f, [k]: v }))}
              onClear={() => setFilters({})}
              showTeamFilter
              teams={allTeams}
            />
            {filtered.length === 0
              ? <EmptyState icon="⊞" title="No tasks" description="No tasks match your filters." />
              : <TaskTable
                  tasks={filtered}
                  onRowClick={setActiveTask}
                  showAssignedTo
                  showAssignedBy
                />
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
