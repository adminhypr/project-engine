import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import ExportBtn from './ExportBtn'

export default function TeamTasksReport({ tasks }) {
  const data = Object.entries(
    tasks.reduce((acc, t) => {
      const name = t.team?.name || 'No Team'
      if (!acc[name]) acc[name] = { name, Open: 0, Done: 0, Overdue: 0, Blocked: 0 }
      if (t.status === 'Done') acc[name].Done++
      else if (t.priority === 'red') acc[name].Overdue++
      else if (t.status === 'Blocked') acc[name].Blocked++
      else acc[name].Open++
      return acc
    }, {})
  ).map(([, v]) => v)

  return (
    <div>
      <ExportBtn data={data} filename="tasks-by-team.csv" />
      <div className="card mb-6">
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,39,68,0.08)" />
            <XAxis dataKey="name" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 30px rgba(26,39,68,0.1)' }} />
            <Legend />
            <Bar dataKey="Open"    fill="#3b82f6" radius={[6,6,0,0]} />
            <Bar dataKey="Done"    fill="#22c55e" radius={[6,6,0,0]} />
            <Bar dataKey="Overdue" fill="#ef4444" radius={[6,6,0,0]} />
            <Bar dataKey="Blocked" fill="#f97316" radius={[6,6,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="card">
        <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="table-th">Team</th>
            <th className="table-th text-center">Open</th>
            <th className="table-th text-center">Done</th>
            <th className="table-th text-center">Overdue</th>
            <th className="table-th text-center">Blocked</th>
            <th className="table-th text-center">Completion %</th>
          </tr></thead>
          <tbody>
            {data.map(r => {
              const total = r.Open + r.Done + r.Overdue + r.Blocked
              const pct   = total ? Math.round((r.Done / total) * 100) : 0
              return (
                <tr key={r.name} className="border-b border-slate-100 dark:border-dark-border">
                  <td className="table-td font-medium">{r.name}</td>
                  <td className="table-td text-center">{r.Open}</td>
                  <td className="table-td text-center text-emerald-600">{r.Done}</td>
                  <td className="table-td text-center text-red-500">{r.Overdue}</td>
                  <td className="table-td text-center text-orange-500">{r.Blocked}</td>
                  <td className="table-td text-center">
                    <span className={`badge ${pct >= 70 ? 'bg-emerald-500/15 text-emerald-700' : pct >= 40 ? 'bg-yellow-500/15 text-yellow-700' : 'bg-red-500/15 text-red-700'}`}>
                      {pct}%
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
