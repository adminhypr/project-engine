import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion'
import { useEffect, useRef } from 'react'

// ── Page transition wrapper ──────────────────
export function PageTransition({ children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

// ── Fade in on mount ─────────────────────────
export function FadeIn({ children, delay = 0, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Staggered children ───────────────────────
export function StaggerChildren({ children, staggerDelay = 0.05, className = '' }) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={{
        visible: { transition: { staggerChildren: staggerDelay } },
        hidden: {}
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className = '' }) {
  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 12 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: 'easeOut' } }
      }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// ── Slide panel (right side) ─────────────────
export function SlidePanel({ isOpen, onClose, children, width = 520 }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-slate-900/20 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed top-0 right-0 h-full w-full sm:w-auto bg-white shadow-panel z-50 flex flex-col border-l border-slate-200"
            style={{ maxWidth: width }}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Animated number count-up ─────────────────
export function AnimatedNumber({ value, className = '' }) {
  const ref = useRef(null)
  const motionValue = useMotionValue(0)
  const rounded = useTransform(motionValue, v => Math.round(v))

  useEffect(() => {
    const controls = animate(motionValue, value, {
      duration: 0.6,
      ease: 'easeOut',
    })
    return controls.stop
  }, [value, motionValue])

  useEffect(() => {
    const unsubscribe = rounded.on('change', v => {
      if (ref.current) ref.current.textContent = v
    })
    return unsubscribe
  }, [rounded])

  return <span ref={ref} className={className}>{value}</span>
}

// ── Success burst (green pulse) ──────────────
export function SuccessBurst({ children, trigger }) {
  return (
    <motion.div
      key={trigger}
      initial={{ scale: 1 }}
      animate={{ scale: [1, 1.08, 1] }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      style={{ originX: 0.5, originY: 0.5 }}
    >
      {children}
    </motion.div>
  )
}

// ── Shake reject (red shake) ─────────────────
export function ShakeReject({ children, trigger }) {
  return (
    <motion.div
      key={trigger}
      animate={{ x: [0, -4, 4, -4, 2, 0] }}
      transition={{ duration: 0.4 }}
    >
      {children}
    </motion.div>
  )
}

// ── Modal wrapper ────────────────────────────
export function ModalWrapper({ isOpen, onClose, children }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            className="fixed inset-0 bg-slate-900/25 z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 pointer-events-none"
          >
            <motion.div
              className="bg-white rounded-2xl shadow-panel border border-slate-200 pointer-events-auto w-full max-w-md"
              initial={{ opacity: 0, scale: 0.95, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 8 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              {children}
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ── Row hover wrapper ────────────────────────
export const MotionRow = motion.tr

export const rowHoverProps = {
  whileHover: { y: -1, boxShadow: '0 2px 12px rgba(0, 0, 0, 0.06)' },
  transition: { duration: 0.15 }
}

// ── Layout animation for list items ──────────
export function AnimatedList({ children, className = '' }) {
  return (
    <motion.div layout className={className}>
      <AnimatePresence mode="popLayout">
        {children}
      </AnimatePresence>
    </motion.div>
  )
}

export function AnimatedListItem({ children, id, className = '' }) {
  return (
    <motion.div
      layout
      layoutId={id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
