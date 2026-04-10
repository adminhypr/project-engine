export default function AttendanceAvatar({ user }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-dark-hover border border-slate-200/60 dark:border-dark-border" title={user.full_name}>
      {user.avatar_url ? (
        <img src={user.avatar_url} className="w-6 h-6 rounded-full" alt="" />
      ) : (
        <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold">
          {user.full_name?.[0] || '?'}
        </div>
      )}
      <span className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate max-w-[8rem]">
        {user.full_name}
      </span>
      <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
    </div>
  )
}
