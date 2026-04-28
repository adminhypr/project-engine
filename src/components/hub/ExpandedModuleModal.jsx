import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X as XIcon } from 'lucide-react'

// Basecamp-style "focus mode" view of a hub module. Renders the module's
// component in a centered floating window above the dashboard, with more
// vertical real estate than the inline card affords.
//
// Components that read the optional `expanded` prop can adapt their
// layout (e.g. Campfire stretches its message list instead of being
// capped at 400px).
export default function ExpandedModuleModal({ module, hubId, kindMeta, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Lock body scroll while the modal is open so the page underneath
  // doesn't bounce when the user scrolls inside the module.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  if (!module || !kindMeta) return null
  const Icon = kindMeta.icon
  const Comp = kindMeta.Comp

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[90] bg-black/60 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
        onClick={onClose}
      >
        <motion.div
          key="panel"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0,  scale: 1 }}
          exit={{ opacity: 0, y: 8,    scale: 0.98 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="bg-white dark:bg-dark-card rounded-2xl shadow-elevated w-full max-w-3xl my-auto flex flex-col"
          style={{ minHeight: '60vh', maxHeight: '90vh' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 dark:border-dark-border shrink-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${kindMeta.color}18` }}
            >
              <Icon size={15} style={{ color: kindMeta.color }} />
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex-1 truncate">
              {module.title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover"
              title="Close (Esc)"
            >
              <XIcon size={16} />
            </button>
          </div>

          {/* Body — fills remaining space */}
          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
            <Comp hubId={hubId} moduleId={module.id} expanded />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
