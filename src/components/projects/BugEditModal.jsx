import { useState } from 'react'
import { ArrowUpRight, Trash2 } from 'lucide-react'
import { ModalWrapper } from '../ui/animations'
import { BUG_STATUSES, BUG_SEVERITIES } from '../../lib/projectBoard'

// Edit a bug: title, description, severity, status. "Promote to Fix Task"
// persists edits, then hands the merged bug up so the parent creates the task
// and opens its setup panel.
export default function BugEditModal({ bug, bugs, onClose, onPromote }) {
  const { updateBug, setStatus, deleteBug } = bugs
  const [title, setTitle] = useState(bug.title || '')
  const [notes, setNotes] = useState(bug.description || '')
  const [severity, setSeverity] = useState(bug.severity || 'Medium')
  const [status, setLocalStatus] = useState(bug.status || 'Reported')
  const [busy, setBusy] = useState(false)

  const persist = async () => {
    await updateBug(bug.id, {
      title: title.trim() || bug.title,
      description: notes.trim() || null,
      severity,
    })
    if (status !== bug.status) await setStatus(bug.id, status)
  }

  const save = async () => { setBusy(true); await persist(); setBusy(false); onClose() }

  const promote = async () => {
    setBusy(true)
    await persist()
    onPromote({ ...bug, title: title.trim() || bug.title, description: notes.trim() || null, severity, status: 'Promoted' })
  }

  const remove = async () => {
    if (!confirm('Delete this bug?')) return
    setBusy(true); await deleteBug(bug.id); onClose()
  }

  const canPromote = bug.status !== 'Promoted'

  return (
    <ModalWrapper isOpen onClose={onClose}>
      <div className="bg-white dark:bg-dark-card rounded-2xl w-full max-w-md p-5 shadow-elevated">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Bug</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Title</label>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} className="form-input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Description</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} rows={4}
              placeholder="Steps to reproduce / Expected / Actual… (carried over to the fix task when promoted)"
              className="form-input w-full resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Severity</label>
              <select value={severity} onChange={e => setSeverity(e.target.value)} className="form-input w-full">
                {BUG_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Status</label>
              <select value={status} onChange={e => setLocalStatus(e.target.value)} className="form-input w-full" disabled={bug.status === 'Promoted'}>
                {BUG_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 mt-5">
          <button onClick={remove} disabled={busy} className="text-red-500 hover:text-red-600 inline-flex items-center gap-1.5 text-sm px-2 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10">
            <Trash2 size={14} /> Delete
          </button>
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy} className="btn-ghost">Save</button>
            {canPromote && (
              <button onClick={promote} disabled={busy} className="btn-primary inline-flex items-center gap-1.5">
                <ArrowUpRight size={15} /> Promote to Fix Task
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalWrapper>
  )
}
