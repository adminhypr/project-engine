import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { EMOJI_CATEGORIES, searchEmojis } from '../../lib/emojiData'

// Slack-style emoji picker popover for the composer. Anchored above the
// composer (mirrors GifPicker positioning + dark-mode styling). Stays OPEN
// when you pick an emoji so you can add several; closes on Escape / outside
// click. Search filters across name + keywords; otherwise shows category
// sections with sticky headers.
export default function EmojiPicker({ open, onClose, onPick }) {
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)
  const rootRef = useRef(null)

  const results = useMemo(() => (query.trim() ? searchEmojis(query) : null), [query])

  // On open: clear query + focus the search box.
  useEffect(() => {
    if (!open) return
    setQuery('')
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) onClose()
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Emoji picker"
      className="absolute bottom-full left-2 mb-2 z-50 w-[320px] max-w-[calc(100vw-2rem)] h-[360px] flex flex-col rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-elevated overflow-hidden"
    >
      <div className="flex items-center gap-2 p-2 border-b border-slate-200 dark:border-dark-border">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search emoji"
            className="w-full rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border pl-8 pr-2 py-1.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close emoji picker"
          className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {results ? (
          results.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-400">
              No emoji found
            </div>
          ) : (
            <div className="grid grid-cols-8 gap-0.5">
              {results.map(e => (
                <EmojiButton key={e.char} emoji={e} onPick={onPick} />
              ))}
            </div>
          )
        ) : (
          EMOJI_CATEGORIES.map(cat => (
            <div key={cat.id} className="mb-1">
              <div className="sticky top-0 z-10 bg-white dark:bg-dark-card px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                {cat.label}
              </div>
              <div className="grid grid-cols-8 gap-0.5">
                {cat.emojis.map(e => (
                  <EmojiButton key={e.char} emoji={e} onPick={onPick} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function EmojiButton({ emoji, onPick }) {
  return (
    <button
      type="button"
      // Keep the textarea selection alive: don't steal focus before the
      // composer's onPick reads selectionStart.
      onMouseDown={e => e.preventDefault()}
      onClick={() => onPick(emoji.char)}
      title={emoji.name}
      aria-label={emoji.name}
      className="w-8 h-8 flex items-center justify-center text-xl rounded hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors"
    >
      <span>{emoji.char}</span>
    </button>
  )
}
