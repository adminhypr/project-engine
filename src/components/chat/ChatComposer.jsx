import { useState } from 'react'
import { Send } from 'lucide-react'

const MAX_LEN = 4000

export default function ChatComposer({ onSend, disabled }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    const trimmed = value.trim()
    if (!trimmed || busy || disabled) return
    setBusy(true)
    const ok = await onSend(trimmed)
    setBusy(false)
    if (ok) setValue('')
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="border-t border-slate-200 dark:border-dark-border p-2 flex items-end gap-2">
      <textarea
        value={value}
        onChange={e => setValue(e.target.value.slice(0, MAX_LEN))}
        onKeyDown={handleKey}
        placeholder="Type a message…"
        rows={1}
        className="flex-1 resize-none rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border px-3 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 max-h-32"
      />
      <button
        type="button"
        onClick={submit}
        disabled={busy || disabled || !value.trim()}
        className="w-9 h-9 rounded-full bg-brand-500 hover:bg-brand-600 text-white disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center justify-center"
        aria-label="Send"
      >
        <Send className="w-4 h-4" />
      </button>
    </div>
  )
}
