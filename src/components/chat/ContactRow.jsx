import PresenceDot from './PresenceDot'

export default function ContactRow({ row, online, onClick }) {
  const { profile, conversation } = row
  const initial = (profile.full_name || '?').charAt(0).toUpperCase()
  const unread = conversation?.unread || 0
  const preview = conversation?.last_message_preview
  return (
    <button
      type="button"
      onClick={() => onClick(profile.id)}
      className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-left"
    >
      <div className="relative w-9 h-9 flex-shrink-0">
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 font-semibold flex items-center justify-center">
            {initial}
          </div>
        )}
        <span className="absolute bottom-0 right-0">
          <PresenceDot online={online} />
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
            {profile.full_name || profile.email}
          </span>
          {unread > 0 && (
            <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-red-500 text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </div>
        {preview && (
          <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{preview}</div>
        )}
      </div>
    </button>
  )
}
