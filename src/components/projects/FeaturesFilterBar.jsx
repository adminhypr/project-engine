import { X } from 'lucide-react'
import { FEATURE_URGENCIES, EMPTY_FEATURE_FILTERS, hasActiveFeatureFilter } from '../../lib/projectBoard'

const DUE_OPTIONS = [
  ['any', 'Any due date'],
  ['overdue', 'Overdue'],
  ['week', 'Due this week'],
  ['none', 'No due date'],
]

// Lightweight filter bar over the Features board/list: Mine, Urgency chips, a
// Due-date bucket. Pure presentational — the parent owns the filters object and
// applies filterFeatures(). Requests/Bugs don't carry these fields, so this
// only sits over Features.
export default function FeaturesFilterBar({ filters, onChange }) {
  const { mine = false, urgencies = [], due = 'any' } = filters || {}
  const active = hasActiveFeatureFilter(filters)

  const chip = (on) =>
    `text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
      on
        ? 'bg-brand-500 text-white border-brand-500'
        : 'bg-transparent text-slate-500 dark:text-slate-400 border-slate-200 dark:border-dark-border hover:border-brand-400'
    }`

  const toggleUrgency = (u) =>
    onChange({ ...filters, urgencies: urgencies.includes(u) ? urgencies.filter(x => x !== u) : [...urgencies, u] })

  return (
    <div className="flex items-center gap-1.5 flex-wrap mb-3">
      <button onClick={() => onChange({ ...filters, mine: !mine })} className={chip(mine)}>Mine</button>
      <span className="w-px h-4 bg-slate-200 dark:bg-dark-border mx-0.5" />
      <span className="text-[11px] text-slate-400 mr-0.5">Urgency</span>
      {FEATURE_URGENCIES.map(u => (
        <button key={u} onClick={() => toggleUrgency(u)} className={chip(urgencies.includes(u))}>{u}</button>
      ))}
      <span className="w-px h-4 bg-slate-200 dark:bg-dark-border mx-0.5" />
      <select
        value={due}
        onChange={e => onChange({ ...filters, due: e.target.value })}
        className="form-input text-[11px] py-0.5 px-1.5 w-auto"
      >
        {DUE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {active && (
        <button
          onClick={() => onChange({ ...EMPTY_FEATURE_FILTERS })}
          className="text-[11px] text-slate-400 hover:text-brand-500 inline-flex items-center gap-0.5 ml-0.5"
        >
          <X size={12} /> Clear
        </button>
      )}
    </div>
  )
}
