import { formatDateShort } from '../../lib/helpers'
import ExportBtn from './ExportBtn'

export default function UpcomingReport({ tasks }) {
  const now = new Date()
  const upcoming = tasks
    .filter(t => t.due_date && new Date(t.due_date) >= now && t.status !== 'Done')
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))

  const csvData = upcoming.map(t => ({
    'Task':        t.title,
    'Assigned To': t.assignee?.full_name,
    'Team':        t.team?.name,
    'Due Date':    formatDateShort(t.due_date),
    'Urgency':     t.urgency,
    'Status':      t.status,
    'Priority':    t.priority,
  }))

  return (
    <div>
      <ExportBtn data={csvData} filename="upcoming-tasks.csv" />
      {upcoming.length === 0
        ? <div className="card text-center py-12 text-navy-400">No upcoming tasks with due dates.</div>
        : <div className="card">
            <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="table-th">Task</th>
                <th className="table-th">Assigned To</th>
                <th className="table-th">Team</th>
                <th className="table-th">Due Date</th>
                <th className="table-th">Urgency</th>
                <th className="table-th">Status</th>
                <th className="table-th">Priority</th>
              </tr></thead>
              <tbody>
                {upcoming.map(t => (
                  <tr key={t.id} className={`border-b border-navy-100/20 priority-${t.priority}`}>
                    <td className="table-td font-medium">{t.title}</td>
                    <td className="table-td">{t.assignee?.full_name}</td>
                    <td className="table-td">{t.team?.name}</td>
                    <td className="table-td text-xs whitespace-nowrap">{formatDateShort(t.due_date)}</td>
                    <td className="table-td">{t.urgency}</td>
                    <td className="table-td">{t.status}</td>
                    <td className="table-td capitalize">{t.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
      }
    </div>
  )
}
