import { useEffect, useRef } from 'react'

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🎉', '👀', '🙌']

/**
 * Tiny popover with the fixed 8-emoji palette. The caller positions this
 * absolutely; we just render the pill. Closes on outside click or Escape.
 */
export default function ReactionPicker({ onPick, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose?.()
    }
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="flex items-center gap-0.5 px-1.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-elevated"
      role="menu"
      aria-label="Pick a reaction"
    >
      {REACTION_EMOJIS.map(e => (
        <button
          key={e}
          type="button"
          onClick={() => { onPick?.(e); onClose?.() }}
          className="w-7 h-7 flex items-center justify-center text-base rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          aria-label={`React with ${e}`}
          title={e}
        >
          <span>{e}</span>
        </button>
      ))}
    </div>
  )
}
