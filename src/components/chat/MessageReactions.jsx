/**
 * Renders the aggregated reactions for a single message as a row of
 * pills. Clicking a pill toggles the current user's reaction for that
 * emoji. `reactions` comes from useMessageReactions().byMessageId[id].
 */
export default function MessageReactions({ reactions, onToggle }) {
  if (!reactions || reactions.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map(r => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggle?.(r.emoji)}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] leading-none border transition-colors ${
            r.mine
              ? 'bg-brand-500/15 border-brand-400 text-brand-600 dark:text-brand-300'
              : 'bg-slate-100 dark:bg-slate-700/60 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
          }`}
          aria-label={`${r.emoji} ${r.count}${r.mine ? ' — you reacted' : ''}`}
          title={r.mine ? 'Click to remove your reaction' : 'Click to react'}
        >
          <span className="text-sm leading-none">{r.emoji}</span>
          <span>{r.count}</span>
        </button>
      ))}
    </div>
  )
}
