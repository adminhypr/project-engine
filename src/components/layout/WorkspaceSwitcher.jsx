import { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'

export default function WorkspaceSwitcher() {
  const { profile, activeTeamId, setActiveTeamId } = useAuth()
  const [open, setOpen] = useState(false)

  const teams = profile?.all_teams || []
  if (teams.length === 0) return null

  const active = teams.find(t => t.id === activeTeamId) || teams[0]

  return (
    <div className="relative px-4 py-3 border-b border-slate-100 dark:border-dark-border">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-dark-hover/50 dark:hover:bg-dark-hover text-sm font-medium text-slate-900 dark:text-white transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{active?.name || 'Pick a workspace'}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-4 right-4 mt-1 z-50 bg-white dark:bg-dark-surface border border-slate-200 dark:border-dark-border rounded-xl shadow-elevated py-1 max-h-72 overflow-y-auto"
        >
          {teams.map(t => (
            <li key={t.id}>
              <button
                role="option"
                aria-selected={t.id === activeTeamId}
                onClick={() => { setActiveTeamId(t.id); setOpen(false) }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-dark-hover"
              >
                <span className="truncate">{t.name}</span>
                {t.id === activeTeamId && <Check size={14} className="text-brand-600 dark:text-brand-400" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
