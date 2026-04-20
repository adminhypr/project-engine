/**
 * Renders the aggregated reactions for a single message as a row of
 * pills. Clicking a pill toggles the current user's reaction for that
 * emoji. Hovering shows the list of users who reacted with that emoji
 * (Messenger-style reactor tooltip).
 *
 * Props:
 *   reactions     — array from useMessageReactions().byMessageId[id]
 *   onToggle      — (emoji) => void
 *   profileLookup — Map<userId, { full_name, ... }> so we can resolve
 *                   reactor names; unknown ids fall back to "Someone".
 *   myUserId      — used to label your own reaction as "You" in the
 *                   tooltip.
 */
function formatReactorNames(userIds, profileLookup, myUserId) {
  const names = userIds.map(id => {
    if (id === myUserId) return 'You'
    return profileLookup?.get(id)?.full_name || 'Someone'
  })
  // Put "You" first for familiarity — matches Messenger's convention.
  const you = names.filter(n => n === 'You')
  const others = names.filter(n => n !== 'You')
  return [...you, ...others].join(', ')
}

export default function MessageReactions({ reactions, onToggle, profileLookup, myUserId }) {
  if (!reactions || reactions.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map(r => {
        const reactorNames = formatReactorNames(r.users || [], profileLookup, myUserId)
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => onToggle?.(r.emoji)}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] leading-none border transition-colors ${
              r.mine
                ? 'bg-brand-500/15 border-brand-400 text-brand-600 dark:text-brand-300'
                : 'bg-slate-100 dark:bg-slate-700/60 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
            aria-label={`${r.emoji} — ${reactorNames}`}
            title={reactorNames}
          >
            <span className="text-sm leading-none">{r.emoji}</span>
            <span>{r.count}</span>
          </button>
        )
      })}
    </div>
  )
}
