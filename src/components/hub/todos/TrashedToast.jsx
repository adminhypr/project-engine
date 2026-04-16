import { useEffect, useState } from 'react'

export default function TrashedToast({ message, onUndo, onDismiss, durationMs = 30000 }) {
  const [remaining, setRemaining] = useState(durationMs)

  useEffect(() => {
    if (remaining <= 0) { onDismiss?.(); return }
    const t = setTimeout(() => setRemaining(r => r - 1000), 1000)
    return () => clearTimeout(t)
  }, [remaining, onDismiss])

  const secs = Math.ceil(remaining / 1000)

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-slate-900 text-white shadow-elevated text-sm">
      <span>✓ {message}</span>
      <button
        onClick={() => { onUndo?.(); onDismiss?.() }}
        className="underline font-semibold hover:text-brand-300"
      >
        Undo
      </button>
      <span className="text-xs text-slate-400 tabular-nums">{secs}s</span>
    </div>
  )
}
