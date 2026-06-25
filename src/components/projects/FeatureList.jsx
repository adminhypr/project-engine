import { useState } from 'react'
import { Plus } from 'lucide-react'
import { featureProgress } from '../../lib/projectBoard'
import { ProgressBar } from './FeatureCard'

const STATUS_STYLES = {
  'Not Started': 'bg-slate-100 text-slate-600 dark:bg-dark-border dark:text-slate-300',
  'In Progress': 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  'Blocked':     'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  'Done':        'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
}

export default function FeatureList({ features, firstColumnId, onAddFeature, onOpenFeature }) {
  const [title, setTitle] = useState('')
  const sorted = [...features].sort((a, b) => (a.project_pos ?? 0) - (b.project_pos ?? 0))

  const add = async () => {
    if (!title.trim()) return
    await onAddFeature({ title: title.trim(), columnId: firstColumnId })
    setTitle('')
  }

  return (
    <div className="card divide-y divide-slate-100 dark:divide-dark-border">
      {sorted.length === 0 && (
        <p className="px-4 py-6 text-sm text-slate-400 text-center">No features yet. Add the first one below.</p>
      )}
      {sorted.map(f => {
        const { pct } = featureProgress(f)
        const due = f.due_date ? new Date(f.due_date) : null
        const overdue = due && f.status !== 'Done' && due < new Date()
        return (
          <button key={f.id} onClick={() => onOpenFeature(f)} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors">
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{f.title}</span>
              <span className="block w-40 mt-1"><ProgressBar pct={pct} /></span>
            </span>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[f.status] || STATUS_STYLES['Not Started']}`}>{f.status}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400 w-24 truncate text-right shrink-0">{f.assignee?.full_name || '—'}</span>
            <span className={`text-xs w-16 text-right shrink-0 ${overdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
              {due ? due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
            </span>
          </button>
        )
      })}

      <div className="px-4 py-2.5 flex items-center gap-2">
        <Plus size={14} className="text-slate-400" />
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="Add a feature…"
          className="form-input text-sm flex-1 border-0 bg-transparent focus:ring-0 px-0"
        />
        {title.trim() && <button onClick={add} className="btn-primary text-xs px-3 py-1">Add</button>}
      </div>
    </div>
  )
}
