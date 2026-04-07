import { Users } from 'lucide-react'

const DEFAULT_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

export default function HubCard({ hub, onClick }) {
  const color = hub.color || DEFAULT_COLORS[Math.abs(hub.name.charCodeAt(0)) % DEFAULT_COLORS.length]

  return (
    <button
      onClick={onClick}
      className="card shadow-card dark:shadow-none text-left w-full p-4 hover:shadow-elevated hover:border-slate-300 dark:hover:border-slate-600 transition-all duration-150 group"
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-lg font-bold shrink-0"
          style={{ backgroundColor: color }}
        >
          {hub.icon || hub.name[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
            {hub.name}
          </h3>
          {hub.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{hub.description}</p>
          )}
          <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-400 dark:text-slate-500">
            <Users size={12} />
            <span>{hub.member_count} member{hub.member_count !== 1 ? 's' : ''}</span>
            {hub.team_id && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-dark-border text-xs">Team</span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
