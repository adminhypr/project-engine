import { Home, ChevronRight } from 'lucide-react'

export default function FolderBreadcrumb({ path, onNavigate }) {
  if (path.length === 0) return null

  return (
    <nav className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 overflow-x-auto">
      <button onClick={() => onNavigate(0)} className="flex items-center gap-1 hover:text-brand-500 transition-colors shrink-0">
        <Home size={12} />
        Root
      </button>
      {path.map((item, i) => (
        <span key={item.id} className="flex items-center gap-1 shrink-0">
          <ChevronRight size={12} className="text-slate-300 dark:text-slate-600" />
          <button
            onClick={() => onNavigate(i + 1)}
            className={`hover:text-brand-500 transition-colors ${i === path.length - 1 ? 'font-semibold text-slate-700 dark:text-slate-200' : ''}`}
          >
            {item.name}
          </button>
        </span>
      ))}
    </nav>
  )
}
