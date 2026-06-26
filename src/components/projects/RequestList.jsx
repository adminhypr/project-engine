import { useState } from 'react'
import { Plus, ArrowUpRight, AlignLeft } from 'lucide-react'
import { groupRequestsByStatus, REQUEST_STATUSES } from '../../lib/projectBoard'
import DataTable, { GROUP_COLORS } from './DataTable'

// Feature Request status → monday group/pill color.
const STATUS_COLOR = {
  'Requested':    'slate',
  'Under Review': 'amber',
  'Planned':      'blue',
  'Rejected':     'red',
  'Promoted':     'emerald',
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
      {REQUEST_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}

export default function RequestList({ requests, onPromote, onOpenRequest }) {
  const { requests: list, addRequest, setStatus } = requests
  const [title, setTitle] = useState('')

  const groups = groupRequestsByStatus(list).map(g => ({
    key: g.status, label: g.status, color: STATUS_COLOR[g.status] || 'slate', items: g.requests,
  }))

  const columns = [
    {
      key: 'title', header: 'Item', width: 'minmax(240px,1fr)',
      render: r => (
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="text-sm text-slate-800 dark:text-slate-100 truncate">{r.title}</span>
            {r.description && <AlignLeft size={12} className="text-slate-400 shrink-0" title="Has notes" />}
          </span>
          {r.requester?.full_name && <span className="block text-[11px] text-slate-400">by {r.requester.full_name}</span>}
        </span>
      ),
    },
    {
      key: 'status', header: 'Status', width: '150px',
      render: r => (
        <StatusSelect
          value={r.status}
          color={STATUS_COLOR[r.status]}
          disabled={r.status === 'Promoted'}
          onChange={(s) => setStatus(r.id, s)}
        />
      ),
    },
    {
      key: 'actions', header: '', width: '108px', align: 'right',
      render: r => (
        r.status !== 'Promoted' && r.status !== 'Rejected'
          ? (
            <button
              onClick={(e) => { e.stopPropagation(); onPromote(r) }}
              className="btn-ghost text-[11px] px-2 py-1 inline-flex items-center gap-1 shrink-0"
              title="Promote to a feature"
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
    await addRequest({ title: title.trim() })
    setTitle('')
  }

  const footer = (
    <div className="px-3 py-2.5 flex items-center gap-2 border-t border-slate-100 dark:border-dark-border border-l-[3px] border-l-transparent">
      <Plus size={14} className="text-slate-400 shrink-0" />
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        placeholder="Request a feature…"
        className="form-input text-sm flex-1 border-0 bg-transparent focus:ring-0 px-0"
      />
      {title.trim() && <button onClick={add} className="btn-primary text-xs px-3 py-1 shrink-0">Add</button>}
    </div>
  )

  return (
    <DataTable
      groups={groups}
      columns={columns}
      onRowClick={onOpenRequest}
      footer={footer}
      emptyText="No requests yet. Capture an idea below."
    />
  )
}
