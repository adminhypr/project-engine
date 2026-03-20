import { useState } from 'react'
import { motion } from 'framer-motion'
import { useAuditLogReport, formatEventType } from '../../hooks/useAuditLog'
import { formatDate } from '../../lib/helpers'
import { LoadingScreen } from '../../components/ui'
import ExportBtn from './ExportBtn'

const EVENT_TYPES = [
  'task_created', 'status_changed', 'urgency_changed',
  'due_date_changed', 'notes_updated', 'reassigned',
  'accepted', 'declined', 'assigner_override'
]

export default function AuditLogReport({ dateFrom, dateTo }) {
  const { events, loading } = useAuditLogReport({ dateFrom, dateTo })
  const [filterType, setFilterType] = useState('')
  const [filterPerson, setFilterPerson] = useState('')

  const filtered = events.filter(e => {
    if (filterType && e.event_type !== filterType) return false
    if (filterPerson) {
      const q = filterPerson.toLowerCase()
      if (!(e.performer?.full_name || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  const csvData = filtered.map(e => ({
    'Date':       formatDate(e.created_at),
    'Event':      formatEventType(e.event_type),
    'Task':       e.task?.title || e.task_id,
    'Task ID':    e.task?.task_id || '',
    'Team':       e.task?.team?.name || '',
    'Performed By': e.performer?.full_name || '—',
    'Old Value':  e.old_value || '',
    'New Value':  e.new_value || '',
    'Note':       e.note || '',
  }))

  // Stats
  const byType = events.reduce((acc, e) => {
    acc[e.event_type] = (acc[e.event_type] || 0) + 1
    return acc
  }, {})

  if (loading) return <LoadingScreen />

  return (
    <div className="space-y-5">
      <ExportBtn data={csvData} filename="audit-log.csv" />

      {/* Event type breakdown */}
      <div className="card">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Event Summary</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(byType)
            .sort(([,a], [,b]) => b - a)
            .map(([type, count]) => (
              <motion.button
                key={type}
                onClick={() => setFilterType(filterType === type ? '' : type)}
                className={`badge cursor-pointer transition-all ${
                  filterType === type
                    ? 'bg-brand-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-hover'
                }`}
                whileTap={{ scale: 0.95 }}
              >
                {formatEventType(type)}: {count}
              </motion.button>
            ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="form-input w-full sm:w-48"
        >
          <option value="">All event types</option>
          {EVENT_TYPES.map(t => (
            <option key={t} value={t}>{formatEventType(t)}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Filter by person..."
          value={filterPerson}
          onChange={e => setFilterPerson(e.target.value)}
          className="form-input w-full sm:w-48"
        />
        {(filterType || filterPerson) && (
          <button
            className="btn-secondary text-xs py-1.5 px-3"
            onClick={() => { setFilterType(''); setFilterPerson('') }}
          >
            Clear
          </button>
        )}
        <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">
          {filtered.length} of {events.length} events
        </span>
      </div>

      {/* Events table */}
      <div className="card overflow-x-auto">
        {filtered.length === 0 ? (
          <p className="text-center py-8 text-slate-400 dark:text-slate-500 text-sm">No audit events match your filters.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-th">Timestamp</th>
                <th className="table-th">Event</th>
                <th className="table-th">Task</th>
                <th className="table-th">Team</th>
                <th className="table-th">By</th>
                <th className="table-th">Change</th>
                <th className="table-th">Note</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((e, i) => (
                <motion.tr
                  key={e.id}
                  className="border-b border-slate-100 dark:border-dark-border"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.01 }}
                >
                  <td className="table-td text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                    {formatDate(e.created_at)}
                  </td>
                  <td className="table-td">
                    <span className="badge bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs">
                      {formatEventType(e.event_type)}
                    </span>
                  </td>
                  <td className="table-td">
                    <div className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[200px]">
                      {e.task?.title || '—'}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">{e.task?.task_id}</div>
                  </td>
                  <td className="table-td text-xs text-slate-500 dark:text-slate-400">
                    {e.task?.team?.name || '—'}
                  </td>
                  <td className="table-td text-xs">
                    {e.performer?.full_name || '—'}
                  </td>
                  <td className="table-td text-xs">
                    {e.old_value && e.new_value ? (
                      <span>
                        <span className="text-slate-400 line-through">{e.old_value}</span>
                        {' → '}
                        <span className="font-medium text-slate-700 dark:text-slate-200">{e.new_value}</span>
                      </span>
                    ) : e.new_value ? (
                      <span className="text-slate-700 dark:text-slate-200">{e.new_value}</span>
                    ) : '—'}
                  </td>
                  <td className="table-td text-xs text-slate-400 dark:text-slate-500 max-w-[200px] truncate">
                    {e.note || '—'}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
