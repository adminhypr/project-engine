import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import ExportBtn from './ExportBtn'

const COLORS = ['#d4762c','#22c55e','#3b82f6','#ef4444','#a855f7','#06b6d4','#eab308']

export default function AssignmentTypesReport({ tasks }) {
  const counts = tasks.reduce((acc, t) => {
    acc[t.assignment_type] = (acc[t.assignment_type] || 0) + 1
    return acc
  }, {})
  const pieData = Object.entries(counts).map(([name, value]) => ({ name, value }))
  const total   = tasks.length

  return (
    <div>
      <ExportBtn data={pieData} filename="assignment-types.csv" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="card">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" outerRadius={100}
                   dataKey="value" label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}>
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 30px rgba(26,39,68,0.1)' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="card">
          <table className="w-full text-sm">
            <thead><tr>
              <th className="table-th">Type</th>
              <th className="table-th text-center">Count</th>
              <th className="table-th text-center">%</th>
            </tr></thead>
            <tbody>
              {pieData.sort((a, b) => b.value - a.value).map((r, i) => (
                <tr key={r.name} className="border-b border-navy-100/20">
                  <td className="table-td">
                    <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ background: COLORS[i % COLORS.length] }} />
                    {r.name}
                  </td>
                  <td className="table-td text-center font-semibold">{r.value}</td>
                  <td className="table-td text-center text-navy-500">{total ? Math.round((r.value / total) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
