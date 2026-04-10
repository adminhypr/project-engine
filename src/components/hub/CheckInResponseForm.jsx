import { useState } from 'react'

export default function CheckInResponseForm({ promptId, onSubmit }) {
  const [text, setText]       = useState('')
  const [sending, setSending] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!text.trim() || sending) return
    setSending(true)
    await onSubmit(promptId, text)
    setText('')
    setSending(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Your answer..."
        className="form-input flex-1 text-xs py-1.5"
      />
      <button type="submit" disabled={!text.trim() || sending} className="btn btn-primary text-xs px-3 py-1.5 disabled:opacity-40">
        {sending ? '...' : 'Submit'}
      </button>
    </form>
  )
}
