// Accepts either a single `name` (legacy DM usage) or an array of `names`
// (group usage). Formats Slack-style: "X is typing…", "X and Y are typing…",
// "X, Y, and Z are typing…", "Several people are typing…".

function formatTypingLabel(names) {
  const list = names.filter(Boolean)
  if (list.length === 0) return 'Someone is typing…'
  if (list.length === 1) return `${list[0]} is typing…`
  if (list.length === 2) return `${list[0]} and ${list[1]} are typing…`
  if (list.length === 3) return `${list[0]}, ${list[1]}, and ${list[2]} are typing…`
  return 'Several people are typing…'
}

// Slack-style thin typing row that sits just above the composer: an animated
// three-dot ellipsis followed by the typing label in muted italics.
export default function TypingIndicator({ name, names }) {
  const label = formatTypingLabel(
    Array.isArray(names) && names.length > 0
      ? names
      : (name ? [name] : [])
  )
  return (
    <div className="px-4 h-5 flex items-center gap-1.5 text-[12px] leading-5 text-slate-500 dark:text-slate-400">
      <span className="flex items-center gap-[3px]" aria-hidden="true">
        <span className="w-1 h-1 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce [animation-delay:-0.3s]" />
        <span className="w-1 h-1 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce [animation-delay:-0.15s]" />
        <span className="w-1 h-1 rounded-full bg-slate-400 dark:bg-slate-500 animate-bounce" />
      </span>
      <span className="truncate italic">{label}</span>
    </div>
  )
}
