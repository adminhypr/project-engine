import { format, isToday, isYesterday, isThisYear } from 'date-fns'

export function formatDateLabel(iso) {
  const d = new Date(iso)
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  if (isThisYear(d)) return format(d, 'EEEE, MMMM d')
  return format(d, 'EEEE, MMMM d, yyyy')
}

export function isSameDay(a, b) {
  if (!a || !b) return false
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
}

export default function DateSeparator({ iso }) {
  return (
    <div className="flex items-center gap-3 my-3 px-2" role="separator">
      <div className="flex-1 h-px bg-slate-200 dark:bg-dark-border" />
      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {formatDateLabel(iso)}
      </span>
      <div className="flex-1 h-px bg-slate-200 dark:bg-dark-border" />
    </div>
  )
}
