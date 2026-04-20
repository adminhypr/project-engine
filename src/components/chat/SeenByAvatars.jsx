// Compact stack of "seen by" avatars placed at the end of a message bubble
// in a group conversation. Matches Messenger's convention: first few readers
// visible, overflow collapses to "+N".

const MAX_VISIBLE = 3

export default function SeenByAvatars({ readers, align = 'end' }) {
  if (!readers || readers.length === 0) return null
  const visible = readers.slice(0, MAX_VISIBLE)
  const overflow = readers.length - visible.length
  const joinedNames = readers.map(r => r.profile?.full_name || 'Someone').join(', ')
  return (
    <div
      className={`flex items-center -space-x-1 mt-1 ${align === 'end' ? 'justify-end' : 'justify-start'}`}
      title={`Seen by ${joinedNames}`}
    >
      {visible.map(r => (
        r.profile?.avatar_url ? (
          <img
            key={r.user_id}
            src={r.profile.avatar_url}
            alt=""
            className="w-5 h-5 rounded-full ring-1 ring-white dark:ring-dark-card"
          />
        ) : (
          <span
            key={r.user_id}
            className="w-5 h-5 rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center ring-1 ring-white dark:ring-dark-card"
          >
            {r.profile?.full_name?.[0] || '?'}
          </span>
        )
      ))}
      {overflow > 0 && (
        <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-200 text-[10px] font-bold flex items-center justify-center ring-1 ring-white dark:ring-dark-card">
          +{overflow}
        </span>
      )}
    </div>
  )
}
