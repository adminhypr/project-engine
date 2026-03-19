import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../../lib/supabase'
import { getPriority } from '../../lib/priority'
import { useAuth } from '../../hooks/useAuth'
import { PageHeader, LoadingScreen } from '../../components/ui'
import { PageTransition } from '../../components/ui/animations'

import TeamTasksReport from './TeamTasksReport'
import WorkloadReport from './WorkloadReport'
import ProductivityReport from './ProductivityReport'
import AssignmentMatrixReport from './AssignmentMatrixReport'
import AssignmentTypesReport from './AssignmentTypesReport'
import OverdueReport from './OverdueReport'
import UpcomingReport from './UpcomingReport'
import CompletedTrendReport from './CompletedTrendReport'
import CommentActivityReport from './CommentActivityReport'
import PriorityTrendReport from './PriorityTrendReport'
import AuditLogReport from './AuditLogReport'

const REPORTS = [
  { id: 'team-tasks',        label: 'Tasks by Team' },
  { id: 'workload',          label: 'Workload by Person' },
  { id: 'productivity',      label: 'Productivity per Person' },
  { id: 'assignment-matrix', label: 'Who Assigns to Whom' },
  { id: 'assignment-types',  label: 'Assignment Type Breakdown' },
  { id: 'overdue',           label: 'Overdue Tasks' },
  { id: 'upcoming',          label: 'Upcoming Tasks' },
  { id: 'completed-trend',   label: 'Completed Over Time' },
  { id: 'comment-activity',  label: 'Comment Activity' },
  { id: 'priority-trend',    label: 'Priority Distribution' },
  { id: 'audit-log',         label: 'Audit Log', adminOnly: true },
]

export default function ReportsPage() {
  const { profile, isAdmin } = useAuth()
  const [activeReport, setActiveReport] = useState('team-tasks')
  const [tasks,    setTasks]    = useState([])
  const [comments, setComments] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3)
    return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])

  useEffect(() => {
    async function fetchAll() {
      setLoading(true)
      let tq = supabase.from('tasks').select(`
        *,
        assignee:profiles!tasks_assigned_to_fkey(id, full_name, team_id, teams(name)),
        assigner:profiles!tasks_assigned_by_fkey(id, full_name, team_id, teams(name)),
        team:teams(id, name)
      `)
      .gte('date_assigned', dateFrom)
      .lte('date_assigned', dateTo + 'T23:59:59')

      if (!isAdmin) tq = tq.eq('team_id', profile.team_id)

      const [{ data: tData }, { data: cData }, { data: pData }] = await Promise.all([
        tq,
        supabase.from('comments').select('*, author:profiles(full_name)').gte('created_at', dateFrom),
        supabase.from('profiles').select('*, teams(name)')
      ])

      const enriched = (tData || []).map(t => ({ ...t, priority: getPriority(t) }))
      setTasks(enriched)
      setComments(cData || [])
      setProfiles(pData || [])
      setLoading(false)
    }
    fetchAll()
  }, [dateFrom, dateTo, isAdmin, profile?.team_id])

  return (
    <PageTransition>
      <div className="flex h-full">

        {/* Report list sidebar */}
        <aside className="w-52 min-w-[13rem] border-r border-navy-100/30 bg-white/40 backdrop-blur-sm py-4">
          <p className="px-4 text-xs font-semibold text-navy-400 uppercase tracking-wider mb-2">Reports</p>
          {REPORTS.filter(r => !r.adminOnly || isAdmin).map(r => (
            <button
              key={r.id}
              onClick={() => setActiveReport(r.id)}
              className={`relative w-full text-left px-4 py-2.5 text-sm transition-all duration-200
                ${activeReport === r.id
                  ? 'text-orange-600 font-semibold'
                  : 'text-navy-600 hover:bg-navy-50/50'}`}
            >
              {activeReport === r.id && (
                <motion.div
                  layoutId="report-active"
                  className="absolute inset-0 bg-orange-500/8 border-r-2 border-orange-500"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <span className="relative z-10">{r.label}</span>
            </button>
          ))}
        </aside>

        {/* Report content */}
        <div className="flex-1 overflow-y-auto">
          <PageHeader
            title={REPORTS.find(r => r.id === activeReport)?.label || 'Reports'}
            actions={
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <label className="text-navy-500 font-medium">From</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="form-input w-36 py-1.5" />
                  <label className="text-navy-500 font-medium">To</label>
                  <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="form-input w-36 py-1.5" />
                </div>
              </div>
            }
          />

          <div className="p-6">
            {loading ? <LoadingScreen /> : (
              <motion.div
                key={activeReport}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <ReportContent
                  reportId={activeReport}
                  tasks={tasks}
                  comments={comments}
                  profiles={profiles}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                />
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </PageTransition>
  )
}

function ReportContent({ reportId, tasks, comments, profiles, dateFrom, dateTo }) {
  switch (reportId) {
    case 'team-tasks':        return <TeamTasksReport tasks={tasks} />
    case 'workload':          return <WorkloadReport tasks={tasks} profiles={profiles} />
    case 'productivity':      return <ProductivityReport tasks={tasks} profiles={profiles} />
    case 'assignment-matrix': return <AssignmentMatrixReport tasks={tasks} profiles={profiles} />
    case 'assignment-types':  return <AssignmentTypesReport tasks={tasks} />
    case 'overdue':           return <OverdueReport tasks={tasks} />
    case 'upcoming':          return <UpcomingReport tasks={tasks} />
    case 'completed-trend':   return <CompletedTrendReport tasks={tasks} />
    case 'comment-activity':  return <CommentActivityReport tasks={tasks} comments={comments} profiles={profiles} />
    case 'priority-trend':    return <PriorityTrendReport tasks={tasks} />
    case 'audit-log':         return <AuditLogReport dateFrom={dateFrom} dateTo={dateTo} />
    default: return null
  }
}
