import { useState } from 'react'
import { Plus, ArrowUpRight, AlignLeft } from 'lucide-react'
import { groupBugsByStatus, BUG_STATUSES, BUG_SEVERITIES } from '../../lib/projectBoard'
import { CappedList } from './CappedList'

const STATUS_STYLES = {
  'Reported':   'text-slate-500',
  'Confirmed':  'text-amber-600 dark:text-amber-300',
  "Won't Fix":  'text-red-500',
  'Promoted':   'text-emerald-600 dark:text-emerald-300',
}

// Severity chip colors. Shared by BugList + BugBoard (keep in sync).
export const SEVERITY_STYLES = {
  'Critical': 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  'High':     'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300',
  'Medium':   'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'Low':      'bg-slate-100 text-slate-600 dark:bg-dark-border dark:text-slate-400',
}

export function SeverityChip({ severity }) {
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0 ${SEVERITY_STYLES[severity] || SEVERITY_STYLES.Medium}`}>
      {severity}
    </span>
  )
}

export default function BugList({ bugs, onPromote, onOpenBug }) {
  const { bugs: list, addBug, setStatus } = bugs
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState('Medium')
  const groups = groupBugsByStatus(list)

  const add = async () => {
    if (!title.trim()) return
    await addBug({ title: title.trim(), severity })
    setTitle(''); setSeverity('Medium')
  }

  return (
    <div className="card">
      {list.length === 0 && (
        <p className="px-4 py-6 text-sm text-slate-400 text-center">No bugs reported. File one below.</p>
      )}
      {groups.filter(g => g.bugs.length > 0).map(group => (
        <div key={group.status} className="border-b border-slate-100 dark:border-dark-border last:border-0">
          <p className={`px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLES[group.status]}`}>
            {group.status} <span className="text-slate-300 dark:text-slate-600">({group.bugs.length})</span>
          </p>
          <CappedList items={group.bugs} buttonClassName="border-t border-slate-50 dark:border-dark-border/50">{b => (
            <div key={b.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-dark-hover cursor-pointer" onClick={() => onOpenBug(b)}>
              <SeverityChip severity={b.severity} />
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm text-slate-800 dark:text-slate-100 truncate">{b.title}</span>
                  {b.description && <AlignLeft size={12} className="text-slate-400 shrink-0" title="Has details" />}
                </span>
                {b.reporter?.full_name && <span className="block text-[11px] text-slate-400">by {b.reporter.full_name}</span>}
              </span>
              <select
                value={b.status}
                onClick={e => e.stopPropagation()}
                onChange={e => setStatus(b.id, e.target.value)}
                disabled={b.status === 'Promoted'}
                className="form-input text-[11px] py-1 px-1.5 w-auto shrink-0"
              >
                {BUG_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {b.status !== 'Promoted' && b.status !== "Won't Fix" && (
                <button
                  onClick={(e) => { e.stopPropagation(); onPromote(b) }}
                  className="btn-ghost text-[11px] px-2 py-1 flex items-center gap-1 shrink-0"
                  title="Promote to a fix task"
                >
                  <ArrowUpRight size={12} /> Promote
                </button>
              )}
            </div>
          )}</CappedList>
        </div>
      ))}

      <div className="px-4 py-2.5 flex items-center gap-2 border-t border-slate-100 dark:border-dark-border">
        <Plus size={14} className="text-slate-400" />
        <select value={severity} onChange={e => setSeverity(e.target.value)} className="form-input text-[11px] py-1 px-1.5 w-auto shrink-0">
          {BUG_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="Report a bug…"
          className="form-input text-sm flex-1 border-0 bg-transparent focus:ring-0 px-0"
        />
        {title.trim() && <button onClick={add} className="btn-primary text-xs px-3 py-1">Add</button>}
      </div>
    </div>
  )
}
