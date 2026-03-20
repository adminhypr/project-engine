import { daysBetween, formatDateShort } from '../../lib/helpers'
import ExportBtn from './ExportBtn'

export default function ProductivityReport({ tasks, profiles }) {
  const now = new Date()
  const data = profiles.map(p => {
    const mine     = tasks.filter(t => t.assigned_to === p.id)
    const given    = tasks.filter(t => t.assigned_by === p.id)
    const done     = mine.filter(t => t.status === 'Done')
    const completionRate = mine.length ? Math.round((done.length / mine.length) * 100) : 0

    const avgDays = done.length
      ? Math.round(done.reduce((sum, t) => sum + daysBetween(t.date_assigned, t.last_updated), 0) / done.length)
      : null

    const outstanding = mine.filter(t => t.status !== 'Done')
    const longest = outstanding.length
      ? outstanding.reduce((a, b) => new Date(a.date_assigned) < new Date(b.date_assigned) ? a : b)
      : null

    // Acceptance stats
    const declinableTypes = ['Peer', 'CrossTeam', 'Upward']
    const declinableTasks = mine.filter(t => declinableTypes.includes(t.assignment_type))
    const declinedTasks = mine.filter(t => t.acceptance_status === 'Declined')
    const declineRate = declinableTasks.length
      ? Math.round((declinedTasks.length / declinableTasks.length) * 100)
      : 0

    return {
      name:            p.full_name,
      team:            p.teams?.name || '—',
      received:        mine.length,
      given:           given.length,
      completed:       done.length,
      completionRate,
      avgDays:         avgDays ?? '—',
      outstanding:     outstanding.length,
      longestTask:     longest ? longest.title.substring(0, 40) : '—',
      longestDays:     longest ? Math.round((now - new Date(longest.date_assigned)) / 86400000) : 0,
      declined:        declinedTasks.length,
      declineRate,
    }
  }).filter(r => r.received > 0 || r.given > 0)
    .sort((a, b) => b.received - a.received)

  // Declined tasks log
  const allDeclined = tasks
    .filter(t => t.acceptance_status === 'Declined')
    .sort((a, b) => new Date(b.declined_at || b.last_updated) - new Date(a.declined_at || a.last_updated))

  return (
    <div className="space-y-5">
      <ExportBtn data={data} filename="productivity.csv" />
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="table-th">Person</th>
            <th className="table-th">Team</th>
            <th className="table-th text-center">Received</th>
            <th className="table-th text-center">Assigned Out</th>
            <th className="table-th text-center">Completed</th>
            <th className="table-th text-center">Rate %</th>
            <th className="table-th text-center">Avg Days</th>
            <th className="table-th text-center">Outstanding</th>
            <th className="table-th text-center">Declined</th>
            <th className="table-th text-center">Decline %</th>
            <th className="table-th">Longest Outstanding</th>
          </tr></thead>
          <tbody>
            {data.map(r => (
              <tr key={r.name} className={`border-b border-slate-100 ${r.completionRate < 50 && r.received > 2 ? 'bg-red-500/5' : ''}`}>
                <td className="table-td font-medium">{r.name}</td>
                <td className="table-td text-slate-500">{r.team}</td>
                <td className="table-td text-center">{r.received}</td>
                <td className="table-td text-center">{r.given}</td>
                <td className="table-td text-center text-emerald-600">{r.completed}</td>
                <td className="table-td text-center">
                  <span className={`badge ${r.completionRate >= 70 ? 'bg-emerald-500/15 text-emerald-700' : r.completionRate >= 40 ? 'bg-yellow-500/15 text-yellow-700' : 'bg-red-500/15 text-red-700'}`}>
                    {r.completionRate}%
                  </span>
                </td>
                <td className="table-td text-center">{r.avgDays}</td>
                <td className="table-td text-center font-semibold">{r.outstanding}</td>
                <td className="table-td text-center">{r.declined}</td>
                <td className="table-td text-center">
                  {r.declineRate > 0 && (
                    <span className={`badge ${r.declineRate > 30 ? 'bg-red-500/15 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                      {r.declineRate}%
                    </span>
                  )}
                </td>
                <td className="table-td text-xs text-slate-500">
                  {r.longestTask !== '—' && <span>{r.longestTask} <span className="text-brand-500">({r.longestDays}d)</span></span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Declined Tasks Log */}
      {allDeclined.length > 0 && (
        <div className="card">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Declined Tasks Log ({allDeclined.length})
          </p>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="table-th">Task</th>
              <th className="table-th">Assignee</th>
              <th className="table-th">Assigner</th>
              <th className="table-th">Reason</th>
              <th className="table-th">Date Declined</th>
            </tr></thead>
            <tbody>
              {allDeclined.map(t => (
                <tr key={t.id} className="border-b border-slate-100">
                  <td className="table-td">
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-slate-400">{t.task_id}</div>
                  </td>
                  <td className="table-td text-slate-500">{t.assignee?.full_name}</td>
                  <td className="table-td text-slate-500">{t.assigner?.full_name}</td>
                  <td className="table-td text-xs text-slate-500 italic max-w-[200px] truncate">
                    {t.decline_reason || '—'}
                  </td>
                  <td className="table-td text-xs text-slate-400">
                    {t.declined_at ? formatDateShort(t.declined_at) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
