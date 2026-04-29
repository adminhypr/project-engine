/**
 * Renders the aggregated reactions for a single message as a row of
 * pills. Clicking a pill toggles the current user's reaction for that
 * emoji. Hovering shows an instant styled tooltip listing the reactor
 * names (Messenger / Slack convention).
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
  return [...you, ...others]
}

function ReactionPill({ reaction, onToggle, profileLookup, myUserId }) {
  const reactors = formatReactorNames(reaction.users || [], profileLookup, myUserId)
  const reactorLine = reactors.join(', ')
  return (
    <span className="relative group/reaction inline-flex">
      <button
        type="button"
        onClick={() => onToggle?.(reaction.emoji)}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] leading-none border transition-colors ${
          reaction.mine
            ? 'bg-brand-500/15 border-brand-400 text-brand-600 dark:text-brand-300'
            : 'bg-slate-100 dark:bg-slate-700/60 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
        }`}
        aria-label={`${reaction.emoji} — ${reactorLine}`}
      >
        <span className="text-sm leading-none">{reaction.emoji}</span>
        <span>{reaction.count}</span>
      </button>
      {/* Styled hover tooltip — instant, no 1-2s native-title delay.
          Positioned above the pill; arrow on the bottom edge. */}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-30 opacity-0 group-hover/reaction:opacity-100 transition-opacity duration-100"
      >
        <span className="block px-2 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-[11px] leading-tight whitespace-nowrap shadow-elevated max-w-[220px]">
          <span className="block text-center text-base leading-none mb-1">{reaction.emoji}</span>
          <span className="block whitespace-normal text-center">
            {reactors.map((name, i) => (
              <span key={i}>
                {i > 0 && <span className="text-slate-400">, </span>}
                <span className={name === 'You' ? 'font-semibold' : ''}>{name}</span>
              </span>
            ))}
          </span>
        </span>
        <span className="block w-2 h-2 bg-slate-900 dark:bg-slate-700 rotate-45 absolute left-1/2 -translate-x-1/2 -bottom-1" />
      </span>
    </span>
  )
}

export default function MessageReactions({ reactions, onToggle, profileLookup, myUserId }) {
  if (!reactions || reactions.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map(r => (
        <ReactionPill
          key={r.emoji}
          reaction={r}
          onToggle={onToggle}
          profileLookup={profileLookup}
          myUserId={myUserId}
        />
      ))}
    </div>
  )
}
