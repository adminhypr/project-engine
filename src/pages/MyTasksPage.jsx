import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTasks, useTaskActions } from '../hooks/useTasks'
import { useAuth } from '../hooks/useAuth'
import { applyFilters } from '../lib/filters'
import { PageHeader, StatsStrip, FilterRow, LoadingScreen, EmptyState, showToast } from '../components/ui'
import { PageTransition } from '../components/ui/animations'
import TaskTable from '../components/tasks/TaskTable'
import TaskDetailPanel from '../components/tasks/TaskDetailPanel'
import AcceptanceBanner from '../components/tasks/AcceptanceBanner'
import DeclineModal from '../components/tasks/DeclineModal'

export default function MyTasksPage() {
  const { profile } = useAuth()
  const { myTasks, loading, refetch } = useTasks()
  const { acceptTask, declineTask } = useTaskActions()
  const location = useLocation()
  const navigate = useNavigate()
  const [filters,    setFilters]    = useState({ statuses: ['Not Started', 'In Progress', 'Blocked'] })
  const [activeTask, setActiveTask] = useState(null)
  const [declineTarget, setDeclineTarget] = useState(null)

  // Open task panel from notification click
  useEffect(() => {
    const openTaskId = location.state?.openTaskId
    if (openTaskId && myTasks.length > 0) {
      const task = myTasks.find(t => t.id === openTaskId)
      if (task) setActiveTask(task)
      // Clear the state so it doesn't reopen on re-render
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state?.openTaskId, myTasks])

  const pendingTasks = myTasks.filter(t => t.acceptance_status === 'Pending')
  const filtered = applyFilters(myTasks, filters)

  const stats = [
    { label: 'Overdue / Inactive', value: myTasks.filter(t => t.priority === 'red').length,    color: 'text-red-500' },
    { label: 'Urgent',             value: myTasks.filter(t => t.priority === 'orange').length,  color: 'text-orange-500' },
    { label: 'Completed',          value: myTasks.filter(t => t.status === 'Done').length,      color: 'text-emerald-600' },
    { label: 'Total Tasks',        value: myTasks.length,                                        color: 'text-slate-900 dark:text-white' },
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

  if (loading) return <LoadingScreen />

  return (
    <PageTransition>
      <div>
        <PageHeader
          title="My Tasks"
          subtitle={`Tasks assigned to ${profile?.full_name}`}
        />

        <AcceptanceBanner count={pendingTasks.length} />

        <StatsStrip stats={stats} />

        <div className="p-4 sm:p-6">
          <div className="card">
            <FilterRow
              filters={filters}
              onChange={(k, v) => setFilters(f => ({ ...f, [k]: v }))}
              onClear={() => setFilters({ statuses: ['Not Started', 'In Progress', 'Blocked'] })}
            />
            {filtered.length === 0
              ? <EmptyState
                  icon="✓"
                  title="No tasks"
                  description={Object.keys(filters).length ? "No tasks match your filters." : "You have no tasks assigned to you yet."}
                />
              : <TaskTable
                  tasks={filtered}
                  onRowClick={setActiveTask}
                  showAssignedBy
                  showAcceptanceActions
                  onAccept={handleAccept}
                  onDecline={task => setDeclineTarget(task)}
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

        <DeclineModal
          isOpen={!!declineTarget}
          onClose={() => setDeclineTarget(null)}
          onConfirm={handleDecline}
          taskTitle={declineTarget?.title}
        />
      </div>
    </PageTransition>
  )
}
