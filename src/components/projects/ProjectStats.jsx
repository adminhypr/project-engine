import { useMemo } from 'react'
import { Layers, Loader2, AlertTriangle, Inbox, Bug } from 'lucide-react'
import { projectStats } from '../../lib/projectBoard'

// Quick-glance roll-up strip shown at the top of a project page. Summarizes the
// three lanes (Features / Requests / Bugs) so members get a report without
// scrolling. Counts come from the tested `projectStats` helper.
function Tile({ icon: Icon, label, value, sub, tone = 'default' }) {
  const tones = {
    default: 'text-slate-900 dark:text-white',
    brand:   'text-brand-600 dark:text-brand-400',
    alert:   'text-red-600 dark:text-red-400',
    muted:   'text-slate-400 dark:text-slate-500',
  }
  const iconTones = {
    default: 'text-slate-400 dark:text-slate-500',
    brand:   'text-brand-500',
    alert:   'text-red-500',
    muted:   'text-slate-300 dark:text-slate-600',
  }
  return (
    <div className="flex-1 min-w-[120px] bg-white dark:bg-dark-card rounded-xl border border-slate-200/60 dark:border-dark-border px-3.5 py-2.5 shadow-soft dark:shadow-none">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
        <Icon size={13} className={iconTones[tone]} />
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`text-2xl font-bold leading-none ${tones[tone]}`}>{value}</span>
        {sub && <span className="text-xs text-slate-400 dark:text-slate-500">{sub}</span>}
      </div>
    </div>
  )
}

export default function ProjectStats({ features, requests, bugs }) {
  const s = useMemo(() => projectStats(features, requests, bugs), [features, requests, bugs])

  return (
    <div className="flex flex-wrap gap-2 sm:gap-3">
      <Tile
        icon={Layers}
        label="Features"
        value={s.features}
        sub={s.features ? `${s.done} done · ${s.pct}%` : null}
      />
      <Tile icon={Loader2} label="In Progress" value={s.inProgress} tone={s.inProgress ? 'brand' : 'muted'} />
      <Tile
        icon={AlertTriangle}
        label="Overdue"
        value={s.overdue}
        tone={s.overdue ? 'alert' : 'muted'}
      />
      <Tile icon={Inbox} label="Open Requests" value={s.openRequests} tone={s.openRequests ? 'default' : 'muted'} />
      <Tile
        icon={Bug}
        label="Open Bugs"
        value={s.openBugs}
        sub={s.criticalBugs ? `${s.criticalBugs} high+` : null}
        tone={s.criticalBugs ? 'alert' : s.openBugs ? 'default' : 'muted'}
      />
    </div>
  )
}
