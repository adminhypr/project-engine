import PresenceDot from '../PresenceDot'

// A single Slack-style sidebar row. Pure presentation.
//
// Props:
//   label        — row text
//   kind         — 'channel' | 'dm' | 'task' (drives the leading icon slot)
//   online       — boolean (DM presence dot); ignored for non-DM rows
//   unread       — boolean; bold + bright white when true
//   mentionCount — number; renders a red pill badge when > 0
//   active       — boolean; brand highlight
//   onClick      — row click

export default function SidebarRow({
  label,
  kind = 'channel',
  online = false,
  unread = false,
  mentionCount = 0,
  active = false,
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`h-7 w-full px-2 mx-1 rounded-md flex items-center gap-2 cursor-pointer text-left ${
        active
          ? 'bg-slack-item-active text-white'
          : unread
            ? 'text-white hover:bg-white/[0.06]'
            : 'text-white/60 hover:bg-white/[0.06]'
      }`}
    >
      {/* Leading icon slot: # for channels, presence dot for DMs */}
      <span className="w-4 shrink-0 grid place-items-center text-[15px] leading-none">
        {kind === 'dm' ? (
          <PresenceDot online={online} className="ring-0" />
        ) : (
          <span className={active ? 'text-white/80' : 'text-white/40'}>#</span>
        )}
      </span>

      <span className={`flex-1 min-w-0 truncate text-[15px] ${unread ? 'font-bold' : ''}`}>
        {label}
      </span>

      {mentionCount > 0 && (
        <span className="ml-auto min-w-[18px] h-[18px] px-1.5 rounded-full bg-slack-mention text-white text-[12px] font-bold grid place-items-center">
          {mentionCount > 99 ? '99+' : mentionCount}
        </span>
      )}
    </button>
  )
}
