import { useState } from 'react'
import { Plus, ArrowUpRight, AlignLeft } from 'lucide-react'
import { groupRequestsByStatus, REQUEST_STATUSES } from '../../lib/projectBoard'

const STATUS_STYLES = {
  'Requested':    'text-slate-500',
  'Under Review': 'text-amber-600 dark:text-amber-300',
  'Planned':      'text-blue-600 dark:text-blue-300',
  'Rejected':     'text-red-500',
  'Promoted':     'text-emerald-600 dark:text-emerald-300',
}

export default function RequestList({ requests, onPromote, onOpenRequest }) {
  const { requests: list, addRequest, setStatus } = requests
  const [title, setTitle] = useState('')
  const groups = groupRequestsByStatus(list)

  const add = async () => {
    if (!title.trim()) return
    await addRequest({ title: title.trim() })
    setTitle('')
  }

  return (
    <div className="card">
      {list.length === 0 && (
        <p className="px-4 py-6 text-sm text-slate-400 text-center">No requests yet. Capture an idea below.</p>
      )}
      {groups.filter(g => g.requests.length > 0).map(group => (
        <div key={group.status} className="border-b border-slate-100 dark:border-dark-border last:border-0">
          <p className={`px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide ${STATUS_STYLES[group.status]}`}>
            {group.status} <span className="text-slate-300 dark:text-slate-600">({group.requests.length})</span>
          </p>
          {group.requests.map(r => (
            <div key={r.id} className="px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 dark:hover:bg-dark-hover cursor-pointer" onClick={() => onOpenRequest(r)}>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-sm text-slate-800 dark:text-slate-100 truncate">{r.title}</span>
                  {r.description && <AlignLeft size={12} className="text-slate-400 shrink-0" title="Has notes" />}
                </span>
                {r.requester?.full_name && <span className="block text-[11px] text-slate-400">by {r.requester.full_name}</span>}
              </span>
              <select
                value={r.status}
                onClick={e => e.stopPropagation()}
                onChange={e => setStatus(r.id, e.target.value)}
                disabled={r.status === 'Promoted'}
                className="form-input text-[11px] py-1 px-1.5 w-auto shrink-0"
              >
                {REQUEST_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {r.status !== 'Promoted' && r.status !== 'Rejected' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onPromote(r) }}
                  className="btn-ghost text-[11px] px-2 py-1 flex items-center gap-1 shrink-0"
                  title="Promote to a feature"
                >
                  <ArrowUpRight size={12} /> Promote
                </button>
              )}
            </div>
          ))}
        </div>
      ))}

      <div className="px-4 py-2.5 flex items-center gap-2 border-t border-slate-100 dark:border-dark-border">
        <Plus size={14} className="text-slate-400" />
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="Request a feature…"
          className="form-input text-sm flex-1 border-0 bg-transparent focus:ring-0 px-0"
        />
        {title.trim() && <button onClick={add} className="btn-primary text-xs px-3 py-1">Add</button>}
      </div>
    </div>
  )
}
