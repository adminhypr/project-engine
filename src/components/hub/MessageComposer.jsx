import { useState, useRef } from 'react'
import RichInput from '../ui/RichInput'

export default function MessageComposer({ hubId, onSubmit, onCancel }) {
  const [title, setTitle]     = useState('')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const submitRef = useRef(null)

  async function handleRichSubmit({ content: richContent, mentions, inlineImages }) {
    if (!richContent.trim() || sending) return
    setSending(true)
    const ok = await onSubmit(title.trim() || null, richContent.trim(), mentions, inlineImages)
    if (!ok) setSending(false)
  }

  return (
    <div className="rounded-xl border border-slate-200/60 dark:border-dark-border bg-white dark:bg-dark-card p-4 space-y-3">
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="form-input w-full text-sm font-semibold"
      />
      <RichInput
        value={content}
        onChange={setContent}
        onSubmit={handleRichSubmit}
        submitRef={submitRef}
        hubId={hubId}
        enableMentions
        enableImages
        placeholder="Write your announcement..."
        rows={3}
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn btn-ghost text-xs">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => submitRef.current?.()}
          disabled={!content.trim() || sending}
          className="btn btn-primary text-xs disabled:opacity-40"
        >
          {sending ? 'Posting...' : 'Post announcement'}
        </button>
      </div>
    </div>
  )
}
