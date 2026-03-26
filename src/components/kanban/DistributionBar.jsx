import { motion } from 'framer-motion'
import { COLUMN_STYLES } from './KanbanColumn'

const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Done']

export default function DistributionBar({ columns }) {
  const total = STATUSES.reduce((sum, s) => sum + (columns[s]?.length || 0), 0)
  if (total === 0) return null

  return (
    <div className="px-4 sm:px-6 mb-3">
      {/* Bar */}
      <div className="flex rounded-full h-2.5 overflow-hidden bg-slate-100 dark:bg-dark-border">
        {STATUSES.map(status => {
          const count = columns[status]?.length || 0
          if (count === 0) return null
          const pct = (count / total) * 100
          return (
            <motion.div
              key={status}
              className={`${COLUMN_STYLES[status].bg} first:rounded-l-full last:rounded-r-full`}
              initial={{ flexBasis: 0 }}
              animate={{ flexBasis: `${pct}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-1.5">
        {STATUSES.map(status => {
          const count = columns[status]?.length || 0
          return (
            <div key={status} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${COLUMN_STYLES[status].bg}`} />
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {status} <span className="font-semibold text-slate-700 dark:text-slate-300">{count}</span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
