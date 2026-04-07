import { useState } from 'react'

export default function MessageComposer({ onSubmit, onCancel }) {
  const [title, setTitle]     = useState('')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!content.trim() || sending) return
    setSending(true)
    const ok = await onSubmit(title.trim() || null, content.trim())
    if (!ok) setSending(false)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200/60 dark:border-dark-border bg-white dark:bg-dark-card p-4 space-y-3">
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="form-input w-full text-sm font-semibold"
      />
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Write your announcement..."
        rows={3}
        className="form-input w-full text-sm resize-none"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost text-xs">
          Cancel
        </button>
        <button type="submit" disabled={!content.trim() || sending} className="btn btn-primary text-xs disabled:opacity-40">
          {sending ? 'Posting...' : 'Post announcement'}
        </button>
      </div>
    </form>
  )
}
