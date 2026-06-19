import { useEffect, useRef, useState, useCallback } from 'react'
import { Search, Loader2, X } from 'lucide-react'
import { searchGifs, trendingGifs, giphyEnabled } from '../../lib/giphy'

// Slack-style GIF picker popover. Hotlinks GIPHY CDN urls (never rehosts),
// shows the required "Powered by GIPHY" attribution, and pins rating=pg via
// the lib. Degrades gracefully when no API key is configured.
export default function GifPicker({ open, onClose, onSelect }) {
  const [query, setQuery] = useState('')
  const [gifs, setGifs] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const rootRef = useRef(null)
  // Guards against out-of-order async responses overwriting newer results.
  const reqIdRef = useRef(0)

  const load = useCallback(async (q) => {
    if (!giphyEnabled) return
    const myReq = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      const { gifs: results } = q.trim()
        ? await searchGifs(q, { limit: 24 })
        : await trendingGifs({ limit: 24 })
      if (reqIdRef.current !== myReq) return
      setGifs(results)
    } catch (e) {
      if (reqIdRef.current !== myReq) return
      setError(e?.code === 'rate_limit' ? 'rate' : 'generic')
      setGifs([])
    } finally {
      if (reqIdRef.current === myReq) setLoading(false)
    }
  }, [])

  // On open: focus the search box and load trending. Reset on close.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setGifs([])
    setError(null)
    if (giphyEnabled) load('')
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open, load])

  // Debounce search input (~300ms).
  useEffect(() => {
    if (!open || !giphyEnabled) return
    const t = setTimeout(() => load(query), 300)
    return () => clearTimeout(t)
  }, [query, open, load])

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
      aria-label="GIF picker"
      className="absolute bottom-full left-2 mb-2 z-50 w-[360px] max-w-[calc(100vw-2rem)] h-[400px] flex flex-col rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-elevated overflow-hidden"
    >
      <div className="flex items-center gap-2 p-2 border-b border-slate-200 dark:border-dark-border">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search GIFs"
            disabled={!giphyEnabled}
            className="w-full rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border pl-8 pr-2 py-1.5 text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close GIF picker"
          className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {!giphyEnabled ? (
          <div className="h-full flex items-center justify-center text-center text-sm text-slate-400 px-4">
            GIF search is not configured
          </div>
        ) : loading ? (
          <div className="h-full flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center text-center text-sm text-slate-400 px-4">
            {error === 'rate'
              ? 'GIPHY rate limit reached — try again in a moment'
              : "Couldn't load GIFs — try again"}
          </div>
        ) : gifs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-slate-400">
            No GIFs found
          </div>
        ) : (
          // 2-column masonry via CSS columns.
          <div className="columns-2 gap-2 [&>*]:mb-2">
            {gifs.map(gif => (
              <button
                key={gif.id}
                type="button"
                onClick={() => { onSelect(gif); onClose() }}
                className="block w-full break-inside-avoid rounded-lg overflow-hidden border border-transparent hover:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
                title={gif.title}
              >
                <img
                  src={gif.previewUrl}
                  alt={gif.title}
                  loading="lazy"
                  className="w-full h-auto block bg-slate-100 dark:bg-slate-800"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-2 py-1 border-t border-slate-200 dark:border-dark-border text-[10px] text-slate-400 text-center select-none">
        Powered by GIPHY
      </div>
    </div>
  )
}
