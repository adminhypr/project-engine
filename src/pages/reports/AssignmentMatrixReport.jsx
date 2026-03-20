import { useState, useMemo } from 'react'
import ExportBtn from './ExportBtn'

export default function AssignmentMatrixReport({ tasks, profiles }) {
  const [topN, setTopN] = useState(0)
  const [teamFilter, setTeamFilter] = useState('')

  const filteredTasks = useMemo(() => {
    if (!teamFilter) return tasks
    return tasks.filter(t => t.team?.name === teamFilter)
  }, [tasks, teamFilter])

  const teams = [...new Set(tasks.map(t => t.team?.name).filter(Boolean))]

  const allNames   = [...new Set(filteredTasks.map(t => t.assigner?.full_name).filter(Boolean))]
  const allAssignees = [...new Set(filteredTasks.map(t => t.assignee?.full_name).filter(Boolean))]

  // Rank by activity for top N
  const namesByActivity = allNames
    .map(n => ({ name: n, count: filteredTasks.filter(t => t.assigner?.full_name === n).length }))
    .sort((a, b) => b.count - a.count)
  const assigneesByActivity = allAssignees
    .map(n => ({ name: n, count: filteredTasks.filter(t => t.assignee?.full_name === n).length }))
    .sort((a, b) => b.count - a.count)

  const names    = topN > 0 ? namesByActivity.slice(0, topN).map(n => n.name) : allNames
  const assignees = topN > 0 ? assigneesByActivity.slice(0, topN).map(n => n.name) : allAssignees

  const matrix = names.map(assigner => {
    const row = { assigner }
    assignees.forEach(assignee => {
      row[assignee] = filteredTasks.filter(t =>
        t.assigner?.full_name === assigner && t.assignee?.full_name === assignee
      ).length
    })
    return row
  })

  const maxVal = Math.max(...matrix.flatMap(r => assignees.map(a => r[a] || 0)), 1)
  const csvData = matrix.map(r => ({ Assigner: r.assigner, ...Object.fromEntries(assignees.map(a => [a, r[a] || 0])) }))

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <ExportBtn data={csvData} filename="assignment-matrix.csv" />
        <select
          value={topN}
          onChange={e => setTopN(Number(e.target.value))}
          className="form-input w-full sm:w-36 py-1.5 text-xs"
        >
          <option value={0}>All people</option>
          <option value={5}>Top 5</option>
          <option value={8}>Top 8</option>
          <option value={10}>Top 10</option>
          <option value={15}>Top 15</option>
        </select>
        <select
          value={teamFilter}
          onChange={e => setTeamFilter(e.target.value)}
          className="form-input w-full sm:w-40 py-1.5 text-xs"
        >
          <option value="">All teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="card overflow-x-auto">
        <p className="text-xs text-slate-500 mb-3">Rows = who assigned, Columns = who received. Darker = more tasks.</p>
        {names.length === 0 ? (
          <p className="text-center py-8 text-slate-400 text-sm">No assignment data for this filter.</p>
        ) : (
          <table className="text-xs border-collapse">
            <thead>
              <tr>
                <th className="table-th sticky left-0 bg-white min-w-[120px]">Assigner ↓ / Assignee →</th>
                {assignees.map(a => <th key={a} className="table-th text-center min-w-[90px]">{a.split(' ')[0]}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrix.map(row => (
                <tr key={row.assigner}>
                  <td className="table-td sticky left-0 bg-white font-medium">{row.assigner}</td>
                  {assignees.map(a => {
                    const val     = row[a] || 0
                    const opacity = val ? 0.15 + (val / maxVal) * 0.85 : 0
                    return (
                      <td key={a} className="table-td text-center font-semibold"
                          style={{ background: val ? `rgba(212,118,44,${opacity})` : 'transparent',
                                   color: opacity > 0.6 ? '#fff' : '#1a2744' }}>
                        {val || ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
