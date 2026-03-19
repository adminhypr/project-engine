import { motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'

export default function AcceptanceBanner({ count, onClick }) {
  if (!count) return null

  return (
    <motion.div
      className="mx-6 mt-6 mb-0 p-4 rounded-2xl bg-yellow-500/10 backdrop-blur-sm border border-yellow-500/20 flex items-center justify-between"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
    >
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-yellow-500/20 flex items-center justify-center">
          <AlertCircle size={18} className="text-yellow-600" />
        </div>
        <div>
          <p className="text-sm font-semibold text-yellow-800">
            Pending Acceptance
          </p>
          <p className="text-xs text-yellow-700/70">
            You have {count} task{count !== 1 ? 's' : ''} awaiting your response
          </p>
        </div>
      </div>
      <motion.span
        className="badge bg-yellow-500 text-white text-sm px-3 py-1"
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        {count}
      </motion.span>
    </motion.div>
  )
}
