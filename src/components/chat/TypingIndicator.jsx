// Accepts either a single `name` (legacy DM usage) or an array of `names`
// (group usage). Formats Messenger-style: "X is typing…", "X and Y are
// typing…", "X, Y, and Z are typing…", "3 people are typing…".

function formatTypingLabel(names) {
  const list = names.filter(Boolean)
  if (list.length === 0) return 'Someone is typing…'
  if (list.length === 1) return `${list[0]} is typing…`
  if (list.length === 2) return `${list[0]} and ${list[1]} are typing…`
  if (list.length === 3) return `${list[0]}, ${list[1]}, and ${list[2]} are typing…`
  return `${list.length} people are typing…`
}

export default function TypingIndicator({ name, names }) {
  const label = formatTypingLabel(
    Array.isArray(names) && names.length > 0
      ? names
      : (name ? [name] : [])
  )
  return (
    <div className="px-3 pb-1 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
      <span className="flex items-center gap-[3px]" aria-hidden="true">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce" />
      </span>
      <span className="truncate">{label}</span>
    </div>
  )
}
