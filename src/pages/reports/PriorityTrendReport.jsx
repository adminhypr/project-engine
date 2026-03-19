import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import ExportBtn from './ExportBtn'

export default function PriorityTrendReport({ tasks }) {
  const byWeek = tasks.reduce((acc, t) => {
    const d    = new Date(t.date_assigned)
    const week = `${d.getFullYear()}-W${String(Math.ceil(d.getDate() / 7)).padStart(2, '0')}`
    if (!acc[week]) acc[week] = { week, red: 0, orange: 0, yellow: 0, green: 0 }
    acc[week][t.priority]++
    return acc
  }, {})

  const data = Object.values(byWeek).sort((a, b) => a.week.localeCompare(b.week))

  return (
    <div>
      <ExportBtn data={data} filename="priority-trend.csv" />
      <div className="card">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(26,39,68,0.08)" />
            <XAxis dataKey="week" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 4px 30px rgba(26,39,68,0.1)' }} />
            <Legend />
            <Area type="monotone" dataKey="green"  stackId="1" stroke="#22c55e" fill="#22c55e" fillOpacity={0.6} />
            <Area type="monotone" dataKey="yellow" stackId="1" stroke="#eab308" fill="#eab308" fillOpacity={0.6} />
            <Area type="monotone" dataKey="orange" stackId="1" stroke="#f97316" fill="#f97316" fillOpacity={0.6} />
            <Area type="monotone" dataKey="red"    stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.6} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
