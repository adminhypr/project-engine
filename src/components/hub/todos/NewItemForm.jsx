import { useState, useRef } from 'react'
import { useHubMembers } from '../../../hooks/useHubMembers'
import RichTextField from './RichTextField'
import { Check, Plus } from 'lucide-react'

export default function NewItemForm({ listId, hubId, onCreate, onCancel }) {
  const { members } = useHubMembers(hubId)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [assigneeIds, setAssigneeIds] = useState([])
  const [attachments, setAttachments] = useState([])
  const [showAssignees, setShowAssignees] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const notesSubmitRef = useRef(null)

  function toggleAssignee(id) {
    setAssigneeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim() || submitting) return
    setSubmitting(true)
    const notesPayload = notesSubmitRef.getPayload ? notesSubmitRef.getPayload() : { mentions: [] }
    const created = await onCreate(listId, {
      title: title.trim(),
      notes: notes || null,
      due_date: dueDate || null,
      assigneeIds,
      attachments,
      mentions: notesPayload.mentions,
    })
    setSubmitting(false)
    if (created) onCancel?.()
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card p-3 space-y-3">
      <div className="flex items-center gap-2 border-b border-slate-100 dark:border-dark-border pb-2">
        <div className="w-[18px] h-[18px] rounded border-2 border-slate-300 dark:border-slate-600 shrink-0" />
        <input
          autoFocus
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Describe this to-do…"
          className="form-input flex-1 border-0 bg-transparent focus:ring-0 px-0 text-sm"
        />
      </div>

      <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-2 text-xs items-start pl-7">
        <span className="text-slate-500 dark:text-slate-400 pt-1">Assigned to</span>
        <button
          type="button"
          onClick={() => setShowAssignees(v => !v)}
          className="text-left text-slate-700 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400"
        >
          {assigneeIds.length === 0 ? <span className="text-slate-400">Type names to assign…</span>
            : assigneeIds.length === 1 ? members.find(m => (m.profile || m).id === assigneeIds[0])?.profile?.full_name
            : `${assigneeIds.length} people`}
        </button>

        {showAssignees && (
          <div className="col-start-2 max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card p-1 space-y-0.5">
            {members.map(m => {
              const p = m.profile || m
              if (!p?.id) return null
              const selected = assigneeIds.includes(p.id)
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleAssignee(p.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs hover:bg-slate-50 dark:hover:bg-dark-hover ${selected ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`}
                >
                  <span className="flex-1 truncate">{p.full_name}</span>
                  {selected && <Check size={12} className="text-brand-500" />}
                </button>
              )
            })}
          </div>
        )}

        <span className="text-slate-500 dark:text-slate-400 pt-1">Due on</span>
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          className="form-input text-xs py-1 px-2 w-40"
        />

        <span className="text-slate-500 dark:text-slate-400 pt-1">Notes</span>
        <div>
          <RichTextField
            value={notes}
            onChange={setNotes}
            onSubmit={() => {}}
            submitRef={notesSubmitRef}
            hubId={hubId}
            placeholder="Add extra details or attach a file…"
            rows={3}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="btn btn-ghost text-xs">Cancel</button>
        <button type="submit" disabled={!title.trim() || submitting} className="btn btn-primary text-xs disabled:opacity-40">
          {submitting ? 'Adding…' : 'Add this to-do'}
        </button>
      </div>
    </form>
  )
}
