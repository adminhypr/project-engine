import { Users } from 'lucide-react'

const DEFAULT_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

export default function HubCard({ hub, onClick }) {
  const color = hub.color || DEFAULT_COLORS[Math.abs(hub.name.charCodeAt(0)) % DEFAULT_COLORS.length]

  return (
    <button
      onClick={onClick}
      className="group w-full text-left bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border rounded-2xl overflow-hidden hover:shadow-elevated hover:border-slate-300 dark:hover:border-slate-600 transition-all duration-200"
    >
      {/* Colored banner */}
      <div className="h-11 w-full relative" style={{ backgroundColor: color }}>
        <div
          className="absolute -bottom-4 left-4 w-9 h-9 rounded-xl bg-white dark:bg-dark-card border-2 border-white dark:border-dark-card shadow-sm flex items-center justify-center text-base font-bold select-none"
          style={{ color }}
        >
          {hub.icon || hub.name[0]?.toUpperCase()}
        </div>
      </div>

      {/* Content */}
      <div className="pt-7 pb-4 px-4">
        <h3 className="text-[15px] font-bold text-slate-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors truncate">
          {hub.name}
        </h3>
        {hub.description ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
            {hub.description}
          </p>
        ) : (
          <p className="text-xs text-slate-400 dark:text-slate-600 mt-1 italic">No description</p>
        )}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-dark-border">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
            <Users size={12} />
            <span>{hub.member_count ?? 0} member{hub.member_count !== 1 ? 's' : ''}</span>
          </div>
          {hub.team_id && (
            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-dark-border text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Team
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
