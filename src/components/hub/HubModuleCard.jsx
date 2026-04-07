import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

export default function HubModuleCard({ title, icon: Icon, children, defaultOpen = true, badge }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="card shadow-card dark:shadow-none overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 sm:px-5 py-3.5 text-left hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors"
      >
        {Icon && <Icon size={18} className="text-brand-500 dark:text-brand-400 shrink-0" />}
        <span className="text-sm font-semibold text-slate-900 dark:text-white flex-1">{title}</span>
        {badge != null && (
          <span className="badge bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300 text-xs px-2 py-0.5">
            {badge}
          </span>
        )}
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={16} className="text-slate-400" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 sm:px-5 pb-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
