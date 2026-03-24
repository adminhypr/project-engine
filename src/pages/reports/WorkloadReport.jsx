import ExportBtn from './ExportBtn'

export default function WorkloadReport({ tasks, profiles }) {
  const data = profiles.map(p => {
    const mine = tasks.filter(t => t.assigned_to === p.id)
    return {
      name:        p.full_name,
      team:        p.profile_teams?.length > 0 ? p.profile_teams.map(pt => pt.team?.name || '').filter(Boolean).join(', ') : p.teams?.name || '—',
      assigned:    mine.length,
      outstanding: mine.filter(t => t.status !== 'Done').length,
      done:        mine.filter(t => t.status === 'Done').length,
      blocked:     mine.filter(t => t.status === 'Blocked').length,
    }
  }).filter(r => r.assigned > 0).sort((a, b) => b.outstanding - a.outstanding)

  return (
    <div>
      <ExportBtn data={data} filename="workload-by-person.csv" />
      <div className="card">
        <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="table-th">Person</th>
            <th className="table-th">Team</th>
            <th className="table-th text-center">Assigned</th>
            <th className="table-th text-center">Outstanding</th>
            <th className="table-th text-center">Done</th>
            <th className="table-th text-center">Blocked</th>
          </tr></thead>
          <tbody>
            {data.map(r => (
              <tr key={r.name} className={`border-b border-slate-100 dark:border-dark-border ${r.outstanding > 10 ? 'bg-red-500/5' : ''}`}>
                <td className="table-td font-medium">{r.name}</td>
                <td className="table-td text-slate-500 dark:text-slate-400">{r.team}</td>
                <td className="table-td text-center">{r.assigned}</td>
                <td className={`table-td text-center font-semibold ${r.outstanding > 10 ? 'text-red-600' : ''}`}>{r.outstanding}</td>
                <td className="table-td text-center text-emerald-600">{r.done}</td>
                <td className="table-td text-center text-orange-500">{r.blocked}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
