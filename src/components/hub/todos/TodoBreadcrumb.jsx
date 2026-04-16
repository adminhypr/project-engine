import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

export default function TodoBreadcrumb({ segments }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mb-3">
      {segments.map((s, i) => {
        const isLast = i === segments.length - 1
        return (
          <span key={i} className="flex items-center gap-1.5">
            {isLast || !s.to ? (
              <span className="text-slate-700 dark:text-slate-300 font-medium truncate">{s.label}</span>
            ) : (
              <Link to={s.to} className="hover:text-brand-600 dark:hover:text-brand-400 truncate">{s.label}</Link>
            )}
            {!isLast && <ChevronRight size={12} className="text-slate-300 dark:text-slate-600 shrink-0" />}
          </span>
        )
      })}
    </nav>
  )
}
