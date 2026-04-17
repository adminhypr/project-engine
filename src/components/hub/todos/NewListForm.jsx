import { useState, useRef } from 'react'
import RichTextField from './RichTextField'
import { todoColorKeys, todoColorClass } from './todoColors'

export default function NewListForm({ hubId, onCreate, onCancel }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('blue')
  const [attachments, setAttachments] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const notesSubmitRef = useRef(null)

  async function handleCreate(e) {
    e.preventDefault()
    if (!title.trim() || submitting) return
    setSubmitting(true)
    const descPayload = notesSubmitRef.getPayload ? notesSubmitRef.getPayload() : { mentions: [] }
    const created = await onCreate({
      title: title.trim(),
      description: description || null,
      color,
      attachments,
      mentions: descPayload.mentions,
    })
    setSubmitting(false)
    if (created) onCancel?.()
  }

  return (
    <form onSubmit={handleCreate} className="rounded-2xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card p-4 space-y-3 shadow-soft">
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Name this list…"
        className="form-input w-full text-base font-semibold border-0 bg-transparent focus:ring-0 px-0"
      />

      <RichTextField
        value={description}
        onChange={setDescription}
        onSubmit={() => { /* notes submit via outer form button */ }}
        submitRef={notesSubmitRef}
        hubId={hubId}
        placeholder="Add extra details or attach a file…"
        rows={3}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
      />

      <div className="flex items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-1.5">
          {todoColorKeys.map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setColor(k)}
              className={`w-5 h-5 rounded-full ${todoColorClass(k)} ${color === k ? 'ring-2 ring-offset-2 ring-brand-500 dark:ring-offset-dark-card' : ''}`}
              title={k}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={onCancel} className="btn btn-ghost text-xs">Cancel</button>
          <button type="submit" disabled={!title.trim() || submitting} className="btn btn-primary text-xs disabled:opacity-40">
            {submitting ? 'Adding…' : 'Add this list'}
          </button>
        </div>
      </div>
    </form>
  )
}
