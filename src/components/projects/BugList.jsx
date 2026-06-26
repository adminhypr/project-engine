import { useState } from 'react'
import { Plus, ArrowUpRight, AlignLeft } from 'lucide-react'
import { groupBugsByStatus, BUG_STATUSES, BUG_SEVERITIES } from '../../lib/projectBoard'
import DataTable, { GROUP_COLORS } from './DataTable'

// Bug status → monday group/pill color.
const STATUS_COLOR = {
  'Reported':   'slate',
  'Confirmed':  'amber',
  "Won't Fix":  'red',
  'Promoted':   'emerald',
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

// A colored, inline status dropdown (keeps quick status changes in the list).
function StatusSelect({ value, color, disabled, onChange }) {
  const c = GROUP_COLORS[color] || GROUP_COLORS.slate
  return (
    <select
      value={value}
      onClick={e => e.stopPropagation()}
      onChange={e => { e.stopPropagation(); onChange(e.target.value) }}
      disabled={disabled}
      className={`w-full text-[11px] font-semibold rounded-md border-0 py-1 pl-2 pr-1 cursor-pointer disabled:cursor-default focus:ring-2 focus:ring-brand-500 ${c.soft} ${c.text}`}
    >
      {BUG_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}

export default function BugList({ bugs, onPromote, onOpenBug }) {
  const { bugs: list, addBug, setStatus } = bugs
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState('Medium')

  const groups = groupBugsByStatus(list).map(g => ({
    key: g.status, label: g.status, color: STATUS_COLOR[g.status] || 'slate', items: g.bugs,
  }))

  const columns = [
    {
      key: 'severity', header: 'Severity', width: '92px',
      render: b => <SeverityChip severity={b.severity} />,
    },
    {
      key: 'title', header: 'Item', width: 'minmax(220px,1fr)',
      render: b => (
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="text-sm text-slate-800 dark:text-slate-100 truncate">{b.title}</span>
            {b.description && <AlignLeft size={12} className="text-slate-400 shrink-0" title="Has details" />}
          </span>
          {b.reporter?.full_name && <span className="block text-[11px] text-slate-400">by {b.reporter.full_name}</span>}
        </span>
      ),
    },
    {
      key: 'status', header: 'Status', width: '150px',
      render: b => (
        <StatusSelect
          value={b.status}
          color={STATUS_COLOR[b.status]}
          disabled={b.status === 'Promoted'}
          onChange={(s) => setStatus(b.id, s)}
        />
      ),
    },
    {
      key: 'actions', header: '', width: '108px', align: 'right',
      render: b => (
        b.status !== 'Promoted' && b.status !== "Won't Fix"
          ? (
            <button
              onClick={(e) => { e.stopPropagation(); onPromote(b) }}
              className="btn-ghost text-[11px] px-2 py-1 inline-flex items-center gap-1 shrink-0"
              title="Promote to a fix task"
            >
              <ArrowUpRight size={12} /> Promote
            </button>
          )
          : <span className="text-[11px] text-slate-300 dark:text-slate-600">—</span>
      ),
    },
  ]

  const add = async () => {
    if (!title.trim()) return
    await addBug({ title: title.trim(), severity })
    setTitle(''); setSeverity('Medium')
  }

  const footer = (
    <div className="px-3 py-2.5 flex items-center gap-2 border-t border-slate-100 dark:border-dark-border border-l-[3px] border-l-transparent">
      <Plus size={14} className="text-slate-400 shrink-0" />
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
      {title.trim() && <button onClick={add} className="btn-primary text-xs px-3 py-1 shrink-0">Add</button>}
    </div>
  )

  return (
    <DataTable
      groups={groups}
      columns={columns}
      onRowClick={onOpenBug}
      footer={footer}
      emptyText="No bugs reported. File one below."
    />
  )
}
