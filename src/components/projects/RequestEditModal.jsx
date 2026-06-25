import { useState } from 'react'
import { ArrowUpRight, Trash2 } from 'lucide-react'
import { ModalWrapper } from '../ui/animations'
import { REQUEST_STATUSES } from '../../lib/projectBoard'
import AssigneeSelect from './AssigneeSelect'
import ProjectAttachments from './ProjectAttachments'

// Edit a feature request: title, notes (inherited as the feature's notes on
// promote), and status. "Promote to Feature" persists edits, then hands the
// merged request + chosen assignee up so the parent creates the task and opens
// its setup panel.
export default function RequestEditModal({ request, requests, onClose, onPromote, members = [], currentUserId = null }) {
  const { updateRequest, setStatus, deleteRequest } = requests
  const [title, setTitle] = useState(request.title || '')
  const [notes, setNotes] = useState(request.description || '')
  const [status, setLocalStatus] = useState(request.status || 'Requested')
  const [assigneeId, setAssigneeId] = useState(currentUserId)
  const [attachments, setAttachments] = useState(request.attachments || [])
  const [busy, setBusy] = useState(false)

  // Persist attachments immediately (independent of Save).
  const onAttachmentsChange = async (next) => {
    setAttachments(next)
    await updateRequest(request.id, { attachments: next })
  }

  const persist = async () => {
    await updateRequest(request.id, { title: title.trim() || request.title, description: notes.trim() || null })
    if (status !== request.status) await setStatus(request.id, status)
  }

  const save = async () => { setBusy(true); await persist(); setBusy(false); onClose() }

  const promote = async () => {
    setBusy(true)
    await persist()
    // Pass the merged values so the new feature inherits the just-typed notes
    // even before the refetch lands.
    onPromote({ ...request, title: title.trim() || request.title, description: notes.trim() || null, status: 'Promoted' }, assigneeId)
  }

  const remove = async () => {
    if (!confirm('Delete this request?')) return
    setBusy(true); await deleteRequest(request.id); onClose()
  }

  const canPromote = request.status !== 'Promoted'

  return (
    <ModalWrapper isOpen onClose={onClose}>
      <div className="bg-white dark:bg-dark-card rounded-2xl w-full max-w-md p-5 shadow-elevated">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Feature Request</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Title</label>
            <input autoFocus value={title} onChange={e => setTitle(e.target.value)} className="form-input w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Notes</label>
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)} rows={4}
              placeholder="Context, requirements, links… (carried over to the feature when promoted)"
              className="form-input w-full resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Attachments</label>
            <ProjectAttachments
              attachments={attachments}
              onChange={onAttachmentsChange}
              projectId={request.project_id}
              entityKind="request"
              entityId={request.id}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Status</label>
            <select value={status} onChange={e => setLocalStatus(e.target.value)} className="form-input w-full" disabled={request.status === 'Promoted'}>
              {REQUEST_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {canPromote && (
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Assign feature to</label>
              <AssigneeSelect members={members} value={assigneeId} onChange={setAssigneeId} className="w-full" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 mt-5">
          <button onClick={remove} disabled={busy} className="text-red-500 hover:text-red-600 inline-flex items-center gap-1.5 text-sm px-2 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10">
            <Trash2 size={14} /> Delete
          </button>
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={busy} className="btn-ghost">Save</button>
            {canPromote && (
              <button onClick={promote} disabled={busy} className="btn-primary inline-flex items-center gap-1.5">
                <ArrowUpRight size={15} /> Promote to Feature
              </button>
            )}
          </div>
        </div>
      </div>
    </ModalWrapper>
  )
}
