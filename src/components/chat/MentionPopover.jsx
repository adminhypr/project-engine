import { useEffect } from 'react'

// Simple member picker shown while the composer has an active @query.
// `people` is the candidate list (already filtered by query). `activeIdx`
// drives arrow-key navigation; `onPick(person)` is called on Enter or click.
export default function MentionPopover({ people, activeIdx, onPick, onHover }) {
  useEffect(() => {
    // Scroll the active item into view when it changes via keyboard.
    const el = document.querySelector(`[data-mention-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  if (!people || people.length === 0) return null

  return (
    <div
      className="absolute left-2 right-2 bottom-full mb-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-elevated z-20"
      role="listbox"
    >
      {people.map((p, i) => (
        <button
          key={p.id}
          type="button"
          data-mention-idx={i}
          onMouseEnter={() => onHover?.(i)}
          onMouseDown={(e) => {
            // Prevent the textarea losing focus before onClick fires.
            e.preventDefault()
            onPick(p)
          }}
          className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs ${
            i === activeIdx
              ? 'bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-200'
              : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
        >
          {p.avatar_url
            ? <img src={p.avatar_url} alt="" className="w-5 h-5 rounded-full shrink-0" />
            : <span className="w-5 h-5 rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                {p.full_name?.[0] || '?'}
              </span>}
          <span className="truncate">{p.full_name}</span>
        </button>
      ))}
    </div>
  )
}
