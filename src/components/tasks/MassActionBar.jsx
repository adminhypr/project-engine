import { motion, AnimatePresence } from 'framer-motion'
import { Trash2 } from 'lucide-react'

export default function MassActionBar({
  selectedCount, onSelectAll, onDeselectAll,
  onBulkStatusChange, onBulkUrgencyChange, onBulkDelete
}) {
  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="overflow-hidden"
        >
          <div className="rounded-xl border bg-brand-50/50 border-brand-200 dark:bg-brand-500/5 dark:border-brand-500/20 px-4 py-3 flex flex-wrap items-center gap-3 mb-3">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {selectedCount} task{selectedCount !== 1 ? 's' : ''} selected
            </span>

            <button onClick={onSelectAll} className="btn-ghost text-xs px-2 py-1">Select All</button>
            <button onClick={onDeselectAll} className="btn-ghost text-xs px-2 py-1">Deselect All</button>

            <div className="border-l border-slate-300 dark:border-dark-border h-5" />

            <select
              defaultValue=""
              onChange={e => { if (e.target.value) { onBulkStatusChange(e.target.value); e.target.value = '' } }}
              className="form-input text-xs py-1.5 px-2 w-auto"
            >
              <option value="" disabled>Change status...</option>
              <option value="Not Started">Not Started</option>
              <option value="In Progress">In Progress</option>
              <option value="Blocked">Blocked</option>
              <option value="Done">Done</option>
            </select>

            <select
              defaultValue=""
              onChange={e => { if (e.target.value) { onBulkUrgencyChange(e.target.value); e.target.value = '' } }}
              className="form-input text-xs py-1.5 px-2 w-auto"
            >
              <option value="" disabled>Change urgency...</option>
              <option value="High">High</option>
              <option value="Med">Med</option>
              <option value="Low">Low</option>
            </select>

            <button onClick={onBulkDelete} className="btn-danger text-xs px-3 py-1.5 flex items-center gap-1.5">
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
