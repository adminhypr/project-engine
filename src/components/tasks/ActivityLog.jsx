import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useAuditLog, formatEventType } from '../../hooks/useAuditLog'
import { formatDate } from '../../lib/helpers'

const EVENT_COLORS = {
  task_created:      'bg-emerald-500',
  status_changed:    'bg-sky-500',
  urgency_changed:   'bg-brand-500',
  due_date_changed:  'bg-purple-500',
  notes_updated:     'bg-slate-400',
  reassigned:        'bg-amber-500',
  accepted:          'bg-emerald-500',
  declined:          'bg-red-500',
  assigner_override: 'bg-brand-500',
}

export default function ActivityLog({ taskId }) {
  const { events, loading } = useAuditLog(taskId)
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="px-5 py-4 border-t border-slate-100 dark:border-dark-border">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider hover:text-slate-700 dark:hover:text-slate-200 transition-colors w-full"
      >
        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Activity Log ({loading ? '...' : events.length})
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="mt-3 ml-2">
              {loading ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 py-2">Loading activity...</p>
              ) : events.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 italic py-2">No activity recorded.</p>
              ) : (
                <div className="relative">
                  {/* Timeline line */}
                  <div className="absolute left-[5px] top-2 bottom-2 w-px bg-slate-200 dark:bg-dark-border" />

                  {events.map((event, i) => (
                    <motion.div
                      key={event.id || i}
                      className="relative flex gap-3 pb-3 last:pb-0"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: i * 0.03 }}
                    >
                      {/* Dot */}
                      <div className={`w-[11px] h-[11px] rounded-full mt-1 flex-shrink-0 ring-2 ring-white dark:ring-dark-card ${EVENT_COLORS[event.event_type] || 'bg-slate-400'}`} />

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                            {formatEventType(event.event_type)}
                          </span>
                          {event.performer?.full_name && (
                            <span className="text-xs text-slate-400 dark:text-slate-500">
                              by {event.performer.full_name}
                            </span>
                          )}
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            {formatDate(event.created_at)}
                          </span>
                        </div>

                        {/* Value change */}
                        {(event.old_value || event.new_value) && event.event_type !== 'task_created' && (
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {event.old_value && event.new_value ? (
                              <span>
                                <span className="text-slate-400 line-through">{event.old_value}</span>
                                {' → '}
                                <span className="font-medium">{event.new_value}</span>
                              </span>
                            ) : event.new_value ? (
                              <span className="font-medium">{event.new_value}</span>
                            ) : null}
                          </div>
                        )}

                        {/* Note */}
                        {event.note && (
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 italic">{event.note}</p>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
