import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import ExportBtn from './ExportBtn'

export default function CompletedTrendReport({ tasks }) {
  const done = tasks.filter(t => t.status === 'Done')

  const byWeek = done.reduce((acc, t) => {
    const d    = new Date(t.last_updated)
    const week = `${d.getFullYear()}-W${String(Math.ceil(d.getDate() / 7)).padStart(2, '0')}`
    acc[week]  = (acc[week] || 0) + 1
    return acc
  }, {})

  const data = Object.entries(byWeek).sort(([a], [b]) => a.localeCompare(b))
    .map(([week, count]) => ({ week, completed: count }))

  return (
    <div>
      <ExportBtn data={data} filename="completed-trend.csv" />
      <div className="card mb-5">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,39,68,0.08)" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 30px rgba(26,39,68,0.1)' }} />
            <Line type="monotone" dataKey="completed" stroke="#d4762c" strokeWidth={2} dot={{ r: 3, fill: '#d4762c' }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="card">
        <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="table-th">Week</th>
            <th className="table-th text-center">Tasks Completed</th>
          </tr></thead>
          <tbody>
            {data.map(r => (
              <tr key={r.week} className="border-b border-slate-100 dark:border-dark-border">
                <td className="table-td">{r.week}</td>
                <td className="table-td text-center font-semibold text-emerald-600">{r.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
