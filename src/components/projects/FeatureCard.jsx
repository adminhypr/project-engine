import { CheckSquare, Clock } from 'lucide-react'
import { featureProgress } from '../../lib/projectBoard'

// Thin Trello-style progress strip used inside the card.
export function ProgressBar({ pct }) {
  if (pct === null || pct === undefined) return null
  return (
    <div className="h-1 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
      <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function OwnerAvatar({ profile }) {
  if (!profile) return null
  const name = profile.full_name || '?'
  return profile.avatar_url
    ? <img src={profile.avatar_url} alt="" title={name} className="w-6 h-6 rounded-full object-cover ring-1 ring-black/5" />
    : <span title={name} className="w-6 h-6 rounded-full bg-brand-500 text-white text-[10px] font-semibold grid place-items-center ring-1 ring-black/5">{name.charAt(0).toUpperCase()}</span>
}

const STATUS_DOT = {
  'Not Started': 'bg-slate-400',
  'In Progress': 'bg-blue-500',
  'Blocked':     'bg-red-500',
  'Done':        'bg-emerald-500',
}

// Urgency badge colors (shown on every card). Urgent/High pop; Med/Low subtle.
const URGENCY_STYLES = {
  'Urgent': 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  'High':   'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  'Med':    'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  'Low':    'bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400',
}

// A Trello-style card: white tile, optional label strip, title, then a footer
// row of badges (status dot, checklist count, due-date chip) + member avatar.
export default function FeatureCard({ feature, onClick, dragHandleProps }) {
  const { pct, done, total } = featureProgress(feature)
  const due = feature.due_date ? new Date(feature.due_date) : null
  const overdue = due && feature.status !== 'Done' && due < new Date()

  return (
    <div
      className="group/card bg-white dark:bg-[#22272b] rounded-lg border border-slate-200/80 dark:border-white/5 shadow-[0_1px_1px_rgba(9,30,66,0.13)] hover:border-brand-400 dark:hover:border-brand-500/60 transition-colors cursor-pointer"
      onClick={onClick}
      {...dragHandleProps}
    >
      {/* Top color strip keyed to status (Trello "label" feel). */}
      <div className={`h-1.5 rounded-t-lg ${STATUS_DOT[feature.status] || 'bg-slate-300'}`} />
      <div className="p-2.5">
        <p className="text-[13px] leading-snug text-slate-800 dark:text-slate-100 mb-1.5">{feature.title}</p>

        {total > 0 && <div className="mb-2"><ProgressBar pct={pct} /></div>}

        <div className="flex items-center gap-1.5 flex-wrap">
          {feature.urgency && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${URGENCY_STYLES[feature.urgency] || URGENCY_STYLES.Med}`}>
              {feature.urgency}
            </span>
          )}
          {total > 0 && (
            <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded ${pct === 100 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>
              <CheckSquare size={12} /> {done}/{total}
            </span>
          )}
          {due && (
            <span className={`inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded ${overdue ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' : 'text-slate-500 dark:text-slate-400'}`}>
              <Clock size={12} /> {due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          )}
          <span className="ml-auto"><OwnerAvatar profile={feature.assignee} /></span>
        </div>
      </div>
    </div>
  )
}
