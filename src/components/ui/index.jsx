import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../lib/priority'
import { ASSIGNMENT_TYPE_STYLES } from '../../lib/assignmentType'
import { AnimatedNumber } from './animations'

// ── Page header ──────────────────────────────
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="bg-white dark:bg-dark-surface border-b border-slate-200/60 dark:border-dark-border px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between sticky top-0 z-10">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="hidden md:flex items-center gap-3 mr-12">{actions}</div>}
    </div>
  )
}

// ── Stats strip ──────────────────────────────
function StatCard({ label, value, color, detail, onClick, index }) {
  const [showTooltip, setShowTooltip] = useState(false)
  const isClickable = !!onClick

  return (
    <motion.div
      className={`relative bg-white dark:bg-dark-card rounded-2xl border border-slate-200/60 dark:border-dark-border p-4 shadow-soft dark:shadow-none transition-all duration-150
        ${isClickable ? 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-card' : ''}
        ${detail ? 'cursor-default' : ''}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      onMouseEnter={() => detail && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={onClick}
    >
      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mb-1">{label}</p>
      <p className={`text-3xl font-bold ${color || 'text-slate-900'}`}>
        <AnimatedNumber value={value} />
      </p>
      <AnimatePresence>
        {showTooltip && detail && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 top-full mt-2 z-30 bg-slate-800 dark:bg-slate-700 text-white text-xs rounded-xl px-3.5 py-2.5 shadow-elevated whitespace-pre-line leading-relaxed"
          >
            {detail}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export function StatsStrip({ stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 p-4 sm:p-6 pb-0">
      {stats.map((stat, i) => (
        <StatCard key={stat.label} {...stat} index={i} />
      ))}
    </div>
  )
}

// ── Priority badge ────────────────────────────
export function PriorityBadge({ priority }) {
  const style = PRIORITY_COLORS[priority] || PRIORITY_COLORS.none
  return (
    <span className={`badge ${style.badge}`}>
      {PRIORITY_LABELS[priority] || priority}
    </span>
  )
}

// ── Assignment type badge ─────────────────────
export function AssignmentBadge({ type }) {
  return (
    <span className={`badge ${ASSIGNMENT_TYPE_STYLES[type] || ASSIGNMENT_TYPE_STYLES.Unknown}`}>
      {type}
    </span>
  )
}

// ── Urgency badge ─────────────────────────────
export function UrgencyBadge({ urgency }) {
  const styles = {
    High: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400',
    Med:  'bg-orange-50 text-orange-700 dark:bg-orange-500/15 dark:text-orange-400',
    Low:  'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
  }
  return <span className={`badge ${styles[urgency] || 'bg-slate-100 text-slate-500'}`}>{urgency}</span>
}

// ── Status badge ──────────────────────────────
export function StatusBadge({ status }) {
  const styles = {
    'Not Started': 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    'In Progress': 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
    'Blocked':     'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400',
    'Done':        'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
  }
  return <span className={`badge ${styles[status] || 'bg-slate-100 text-slate-500'}`}>{status}</span>
}

// ── Spinner ───────────────────────────────────
export function Spinner({ size = 'md' }) {
  const s = size === 'sm' ? 'w-4 h-4 border-2' : 'w-8 h-8 border-3'
  return (
    <div className={`${s} border-brand-500 border-t-transparent rounded-full animate-spin`} />
  )
}

// ── Loading screen ────────────────────────────
export function LoadingScreen() {
  return (
    <div className="h-full flex items-center justify-center p-12">
      <motion.div
        className="text-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Spinner />
        <p className="text-slate-400 text-sm mt-3">Loading...</p>
      </motion.div>
    </div>
  )
}

// ── Empty state ───────────────────────────────
export function EmptyState({ icon, title, description, action }) {
  return (
    <motion.div
      className="text-center py-16 px-6"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {icon && <div className="text-4xl mb-3">{icon}</div>}
      <h3 className="font-semibold text-slate-700 dark:text-slate-200 mb-1">{title}</h3>
      {description && <p className="text-sm text-slate-400 dark:text-slate-500 mb-4">{description}</p>}
      {action}
    </motion.div>
  )
}

// ── Filter row ────────────────────────────────
export function FilterRow({ filters, onChange, onClear, showTeamFilter, teams }) {
  return (
    <div className="flex flex-wrap gap-2 items-center mb-4">
      <input
        type="text"
        placeholder="Search tasks..."
        value={filters.search || ''}
        onChange={e => onChange('search', e.target.value)}
        className="form-input w-full sm:w-44"
      />
      <div className="flex flex-wrap gap-x-3 gap-y-1 items-center">
        {['Not Started', 'In Progress', 'Blocked', 'Done'].map(s => (
          <label key={s} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!filters.statuses || filters.statuses.includes(s)}
              onChange={e => {
                const current = filters.statuses || ['Not Started', 'In Progress', 'Blocked', 'Done']
                const next = e.target.checked ? [...current, s] : current.filter(x => x !== s)
                onChange('statuses', next.length === 4 ? undefined : next)
              }}
              className="rounded border-slate-300 dark:border-dark-border text-brand-500 focus:ring-brand-500 w-3.5 h-3.5"
            />
            {s}
          </label>
        ))}
      </div>
      <select
        value={filters.urgency || ''}
        onChange={e => onChange('urgency', e.target.value)}
        className="form-input w-[calc(50%-0.25rem)] sm:w-36"
      >
        <option value="">All urgencies</option>
        <option>High</option>
        <option>Med</option>
        <option>Low</option>
      </select>
      <select
        value={filters.priority || ''}
        onChange={e => onChange('priority', e.target.value)}
        className="form-input w-[calc(50%-0.25rem)] sm:w-36"
      >
        <option value="">All priorities</option>
        <option value="red">Red</option>
        <option value="orange">Orange</option>
        <option value="yellow">Yellow</option>
        <option value="green">Green</option>
      </select>
      {showTeamFilter && (
        <select
          value={filters.team || ''}
          onChange={e => onChange('team', e.target.value)}
          className="form-input w-[calc(50%-0.25rem)] sm:w-36"
        >
          <option value="">All teams</option>
          {(teams || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      <button className="btn-ghost text-xs px-3 py-2" onClick={onClear}>Clear</button>
    </div>
  )
}

// ── Toast notification ─────────────────────────
// Dedupe identical (message, type) toasts within a 1.5s window. A 5s
// Supabase blip during typing previously fired 15 "Failed to load X"
// calls back-to-back; the existing single-toast slot would chaotically
// re-flash on every call. Suppress the repeats — the user's already
// looking at the message.
let lastToastKey = null
let lastToastAt = 0
const TOAST_DEDUPE_MS = 1500
const TOAST_MAX_STACK = 4

// Shared aria-live container so toasts stack instead of replacing each
// other, and screen readers announce them.
function getToastRoot() {
  let root = document.getElementById('app-toast-root')
  if (!root) {
    root = document.createElement('div')
    root.id = 'app-toast-root'
    root.setAttribute('role', 'status')
    root.setAttribute('aria-live', 'polite')
    root.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none'
    document.body.appendChild(root)
  }
  return root
}

export function showToast(msg, type = 'success') {
  const key = `${type}:${msg}`
  const now = Date.now()
  if (key === lastToastKey && now - lastToastAt < TOAST_DEDUPE_MS) return
  lastToastKey = key
  lastToastAt = now

  const root = getToastRoot()
  while (root.children.length >= TOAST_MAX_STACK) root.firstChild.remove()

  const el = document.createElement('div')
  el.className = `pointer-events-auto cursor-pointer flex items-center gap-3 px-5 py-3 rounded-xl
    text-sm font-medium transition-all duration-300 shadow-elevated max-w-[90vw]
    ${type === 'error'
      ? 'bg-red-600 text-white'
      : 'bg-slate-900 text-white'}`
  el.style.transform = 'translateY(20px)'
  el.style.opacity = '0'

  const text = document.createElement('span')
  text.textContent = msg
  el.appendChild(text)

  const close = document.createElement('span')
  close.textContent = '✕'
  close.setAttribute('aria-hidden', 'true')
  close.className = 'text-white/60 text-xs shrink-0'
  el.appendChild(close)

  let removed = false
  let timer
  function dismiss() {
    if (removed) return
    removed = true
    clearTimeout(timer)
    el.style.transform = 'translateY(20px)'
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 300)
  }
  el.addEventListener('click', dismiss)

  root.appendChild(el)
  requestAnimationFrame(() => {
    el.style.transform = 'translateY(0)'
    el.style.opacity = '1'
  })

  // Errors stay up longer — users need time to read what went wrong.
  timer = setTimeout(dismiss, type === 'error' ? 6000 : 2700)
}
