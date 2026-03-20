import { motion, AnimatePresence } from 'framer-motion'
import { PRIORITY_COLORS, PRIORITY_LABELS } from '../../lib/priority'
import { ASSIGNMENT_TYPE_STYLES } from '../../lib/assignmentType'
import { AnimatedNumber } from './animations'

// ── Page header ──────────────────────────────
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="bg-white border-b border-slate-200/60 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between sticky top-0 z-10">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  )
}

// ── Stats strip ──────────────────────────────
export function StatsStrip({ stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 p-4 sm:p-6 pb-0">
      {stats.map(({ label, value, color }, i) => (
        <motion.div
          key={label}
          className="bg-white rounded-2xl border border-slate-200/60 p-4 shadow-soft"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: i * 0.05 }}
        >
          <p className="text-xs text-slate-500 font-medium mb-1">{label}</p>
          <p className={`text-3xl font-bold ${color || 'text-slate-900'}`}>
            <AnimatedNumber value={value} />
          </p>
        </motion.div>
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
    High: 'bg-red-50 text-red-700',
    Med:  'bg-orange-50 text-orange-700',
    Low:  'bg-emerald-50 text-emerald-700'
  }
  return <span className={`badge ${styles[urgency] || 'bg-slate-100 text-slate-500'}`}>{urgency}</span>
}

// ── Status badge ──────────────────────────────
export function StatusBadge({ status }) {
  const styles = {
    'Not Started': 'bg-slate-100 text-slate-600',
    'In Progress': 'bg-blue-50 text-blue-700',
    'Blocked':     'bg-red-50 text-red-700',
    'Done':        'bg-emerald-50 text-emerald-700'
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
      <h3 className="font-semibold text-slate-700 mb-1">{title}</h3>
      {description && <p className="text-sm text-slate-400 mb-4">{description}</p>}
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
      <select
        value={filters.status || ''}
        onChange={e => onChange('status', e.target.value)}
        className="form-input w-[calc(50%-0.25rem)] sm:w-36"
      >
        <option value="">All statuses</option>
        <option>Not Started</option>
        <option>In Progress</option>
        <option>Blocked</option>
        <option>Done</option>
      </select>
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
let toastTimeout
export function showToast(msg, type = 'success') {
  const existing = document.getElementById('app-toast')
  if (existing) existing.remove()
  clearTimeout(toastTimeout)

  const el = document.createElement('div')
  el.id = 'app-toast'
  el.className = `fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-sm font-medium
    z-50 transition-all duration-300 shadow-elevated
    ${type === 'error'
      ? 'bg-red-600 text-white'
      : 'bg-slate-900 text-white'}`
  el.style.transform = 'translate(-50%, 20px)'
  el.style.opacity = '0'
  el.textContent = msg
  document.body.appendChild(el)

  requestAnimationFrame(() => {
    el.style.transform = 'translate(-50%, 0)'
    el.style.opacity = '1'
  })

  toastTimeout = setTimeout(() => {
    el.style.transform = 'translate(-50%, 20px)'
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 300)
  }, 2700)
}

// ── Confirm dialog ────────────────────────────
export function useConfirm() {
  return (msg) => window.confirm(msg)
}
