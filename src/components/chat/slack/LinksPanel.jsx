import { Loader2, Link as LinkIcon, ExternalLink } from 'lucide-react'
import { formatDateShort } from '../../../lib/helpers'

// Best-effort domain extraction for the secondary line. Falls back to the raw
// url if it doesn't parse (it always should, since hrefs are normalized).
function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export default function LinksPanel({ links = [], loading = false }) {
  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (links.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        No links shared yet.
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4">
      <ul className="space-y-1.5">
        {links.map((l, i) => (
          <li key={`${l.url}-${l.messageId}-${i}`}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 px-3 py-2 rounded-lg border border-slate-200 dark:border-dark-border hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
            >
              <span className="shrink-0 grid place-items-center w-9 h-9 rounded-md bg-slate-100 dark:bg-dark-bg text-slate-500 dark:text-slate-400">
                <LinkIcon className="w-4 h-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400">
                  <span className="truncate">{l.url}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
                  {domainOf(l.url)} · shared by {l.authorName} · {formatDateShort(l.createdAt)}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
