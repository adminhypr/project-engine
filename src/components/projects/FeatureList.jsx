import { useState } from 'react'
import { Plus } from 'lucide-react'
import { featureProgress, groupFeaturesByStatus } from '../../lib/projectBoard'
import { ProgressBar } from './FeatureCard'
import AssigneeSelect from './AssigneeSelect'
import DataTable, { Avatar, StatusPill } from './DataTable'

// Feature (task) status → monday group/pill color.
const STATUS_COLOR = {
  'Not Started': 'slate',
  'In Progress': 'blue',
  'Blocked':     'red',
  'Done':        'emerald',
}

const COLUMNS = [
  {
    key: 'title', header: 'Item', width: 'minmax(220px,1fr)',
    render: f => <span className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{f.title}</span>,
  },
  {
    key: 'owner', header: 'Owner', width: '72px', align: 'center',
    render: f => <Avatar profile={f.assignee} />,
  },
  {
    key: 'status', header: 'Status', width: '132px',
    render: f => <StatusPill label={f.status || 'Not Started'} color={STATUS_COLOR[f.status] || 'slate'} />,
  },
  {
    key: 'progress', header: 'Progress', width: 'minmax(120px,160px)',
    render: f => {
      const { pct } = featureProgress(f)
      return (
        <span className="w-full flex items-center gap-2">
          <span className="flex-1"><ProgressBar pct={pct} /></span>
          <span className="text-[11px] text-slate-400 w-8 text-right shrink-0">{pct === null || pct === undefined ? '—' : `${pct}%`}</span>
        </span>
      )
    },
  },
  {
    key: 'due', header: 'Due', width: '92px', align: 'right',
    render: f => {
      const due = f.due_date ? new Date(f.due_date) : null
      const overdue = due && f.status !== 'Done' && due < new Date()
      return (
        <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
          {due ? due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
        </span>
      )
    },
  },
]

export default function FeatureList({ features, firstColumnId, onAddFeature, onOpenFeature, members = [], currentUserId = null }) {
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState(currentUserId)

  const groups = groupFeaturesByStatus(features).map(g => ({
    key: g.status, label: g.status, color: STATUS_COLOR[g.status] || 'slate', items: g.features,
  }))

  const add = async () => {
    if (!title.trim()) return
    await onAddFeature({ title: title.trim(), columnId: firstColumnId, assigneeId })
    setTitle('')
  }

  const footer = (
    <div className="px-3 py-2.5 flex items-center gap-2 border-t border-slate-100 dark:border-dark-border border-l-[3px] border-l-transparent">
      <Plus size={14} className="text-slate-400 shrink-0" />
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') add() }}
        placeholder="Add a feature…"
        className="form-input text-sm flex-1 border-0 bg-transparent focus:ring-0 px-0"
      />
      {title.trim() && (
        <>
          <AssigneeSelect members={members} value={assigneeId} onChange={setAssigneeId} className="text-[11px] py-1 px-1.5 w-auto shrink-0" />
          <button onClick={add} className="btn-primary text-xs px-3 py-1 shrink-0">Add</button>
        </>
      )}
    </div>
  )

  return (
    <DataTable
      groups={groups}
      columns={COLUMNS}
      onRowClick={onOpenFeature}
      footer={footer}
      emptyText="No features yet. Add the first one below."
    />
  )
}
