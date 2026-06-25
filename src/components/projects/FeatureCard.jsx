import { featureProgress } from '../../lib/projectBoard'

// Small progress bar; renders a dash when pct is null (in-flight, no sub-tasks).
export function ProgressBar({ pct }) {
  if (pct === null || pct === undefined) {
    return <span className="text-[11px] text-slate-400 dark:text-slate-500">—</span>
  }
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-dark-border overflow-hidden">
        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0 tabular-nums">{pct}%</span>
    </div>
  )
}

function OwnerAvatar({ profile }) {
  if (!profile) return null
  const name = profile.full_name || '?'
  return profile.avatar_url
    ? <img src={profile.avatar_url} alt="" title={name} className="w-5 h-5 rounded-full object-cover" />
    : <span title={name} className="w-5 h-5 rounded-full bg-brand-500/80 text-white text-[10px] font-semibold grid place-items-center">{name.charAt(0).toUpperCase()}</span>
}

// The visual body of a feature card (shared by the board's sortable card and
// the drag overlay). Pure presentation.
export default function FeatureCard({ feature, onClick, dragHandleProps }) {
  const { pct } = featureProgress(feature)
  const due = feature.due_date ? new Date(feature.due_date) : null
  const overdue = due && feature.status !== 'Done' && due < new Date()
  return (
    <div
      className="bg-white dark:bg-dark-card rounded-xl border border-slate-200 dark:border-dark-border p-2.5 shadow-soft hover:shadow-card transition-shadow cursor-pointer"
      onClick={onClick}
      {...dragHandleProps}
    >
      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 line-clamp-2 mb-2">{feature.title}</p>
      <div className="mb-2"><ProgressBar pct={pct} /></div>
      <div className="flex items-center justify-between gap-2">
        <OwnerAvatar profile={feature.assignee} />
        {due && (
          <span className={`text-[11px] ${overdue ? 'text-red-500 font-medium' : 'text-slate-400 dark:text-slate-500'}`}>
            {due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
    </div>
  )
}
