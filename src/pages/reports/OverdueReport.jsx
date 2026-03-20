import { formatDateShort } from '../../lib/helpers'
import ExportBtn from './ExportBtn'

export default function OverdueReport({ tasks }) {
  const now = new Date()
  const overdue = tasks
    .filter(t => t.priority === 'red' && t.status !== 'Done')
    .map(t => ({
      ...t,
      daysOverdue: t.due_date
        ? Math.round((now - new Date(t.due_date)) / 86400000)
        : Math.round((now - new Date(t.last_updated)) / 86400000)
    }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue)

  const csvData = overdue.map(t => ({
    'Task ID':     t.task_id,
    'Task':        t.title,
    'Assigned To': t.assignee?.full_name,
    'Team':        t.team?.name,
    'Assigned By': t.assigner?.full_name,
    'Due Date':    t.due_date ? formatDateShort(t.due_date) : '—',
    'Days Overdue': t.daysOverdue,
    'Urgency':     t.urgency,
    'Status':      t.status,
  }))

  return (
    <div>
      <ExportBtn data={csvData} filename="overdue-tasks.csv" />
      {overdue.length === 0
        ? <div className="card text-center py-12 text-emerald-600 font-semibold">✓ No overdue tasks in this period!</div>
        : <div className="card">
            <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="table-th">Task</th>
                <th className="table-th">Assigned To</th>
                <th className="table-th">Team</th>
                <th className="table-th">Due / Last Update</th>
                <th className="table-th text-center">Days Overdue</th>
                <th className="table-th">Urgency</th>
                <th className="table-th">Status</th>
              </tr></thead>
              <tbody>
                {overdue.map(t => (
                  <tr key={t.id} className="border-b border-navy-100/20 bg-red-500/5">
                    <td className="table-td">
                      <div className="font-medium">{t.title}</div>
                      <div className="text-xs text-navy-400">{t.task_id}</div>
                    </td>
                    <td className="table-td">{t.assignee?.full_name}</td>
                    <td className="table-td">{t.team?.name}</td>
                    <td className="table-td text-xs">{t.due_date ? formatDateShort(t.due_date) : formatDateShort(t.last_updated)}</td>
                    <td className="table-td text-center font-bold text-red-600">{t.daysOverdue}d</td>
                    <td className="table-td">{t.urgency}</td>
                    <td className="table-td">{t.status}</td>
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
