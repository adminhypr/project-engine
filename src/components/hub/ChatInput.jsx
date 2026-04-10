import { useState } from 'react'
import { Send } from 'lucide-react'

export default function ChatInput({ onSend }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!text.trim() || sending) return
    setSending(true)
    await onSend(text)
    setText('')
    setSending(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type a message..."
        rows={1}
        className="form-input flex-1 resize-none text-sm min-h-[38px] max-h-24"
      />
      <button
        type="submit"
        disabled={!text.trim() || sending}
        className="btn btn-primary px-3 py-2 shrink-0 disabled:opacity-40"
      >
        <Send size={15} />
      </button>
    </form>
  )
}
