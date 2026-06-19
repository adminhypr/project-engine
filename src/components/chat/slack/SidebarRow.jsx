import { X, Star } from 'lucide-react'
import PresenceDot from '../PresenceDot'

// A single Slack-style sidebar row. Pure presentation.
//
// Props:
//   label        — row text
//   kind         — 'channel' | 'dm' | 'task' (drives the leading icon slot)
//   online       — boolean (DM presence dot); ignored for non-DM rows
//   status       — optional 'active'|'away'|'offline' (preferred over online)
//   profile      — optional DM peer profile ({ avatar_url, full_name, email }).
//                  When provided on a DM row, the leading slot renders a small
//                  avatar (Slack style) with the presence dot overlaid on its
//                  bottom-right corner instead of a bare presence dot.
//   unread       — boolean; bold + bright white when true
//   unreadCount  — number; renders a red count pill when > 0 (Slack-style
//                  per-conversation unread badge, driven by the real unread
//                  count). Shows "99+" past 99.
//   mentionCount — number; renders a red pill badge when > 0 (takes precedence
//                  over unreadCount in the shared badge slot when both > 0)
//   active       — boolean; brand highlight
//   onClick      — row click
//   onHide       — optional; when provided, a hover-only "×" appears on the
//                  right edge that calls onHide() (used to close a DM from the
//                  sidebar). Click is stopPropagation'd so it doesn't open the row.
//   starred      — boolean; whether this row is favorited (filled star icon).
//   onToggleStar — optional; when provided, a hover-only star button appears on
//                  the right edge (left of the × if both are present) that calls
//                  onToggleStar(). Filled when `starred`, outline otherwise.
//                  Click is stopPropagation'd so it doesn't open the row. When
//                  starred, the star stays visible (not hover-only) so the user
//                  can tell which rows are favorited at a glance.

// Small DM avatar (~20px) with a presence dot overlaid on the bottom-right.
// Mirrors the message-avatar look (rounded-lg, object-cover, brand initials
// fallback) at a smaller size for sidebar density.
function DmAvatar({ profile, online, status }) {
  const name = profile?.full_name || profile?.email || '?'
  const initial = name.charAt(0).toUpperCase()
  return (
    <span className="relative inline-flex shrink-0 w-5 h-5">
      {profile?.avatar_url ? (
        <img
          src={profile.avatar_url}
          alt=""
          className="w-5 h-5 rounded-md object-cover"
        />
      ) : (
        <span className="w-5 h-5 rounded-md bg-brand-500/80 text-white text-[10px] font-semibold grid place-items-center">
          {initial}
        </span>
      )}
      {/* Presence dot anchored to the avatar's bottom-right corner. The ring
          matches the sidebar background so the dot reads as a cutout (Slack). */}
      <PresenceDot
        online={online}
        status={status}
        className="absolute -bottom-0.5 -right-0.5 !w-2 !h-2 !ring-1 !ring-[var(--chat-sidebar,#1a1d24)]"
      />
    </span>
  )
}

export default function SidebarRow({
  label,
  kind = 'channel',
  online = false,
  status,
  profile,
  unread = false,
  unreadCount = 0,
  mentionCount = 0,
  active = false,
  onClick,
  onHide,
  starred = false,
  onToggleStar,
}) {
  const isDm = kind === 'dm'
  const showAvatar = isDm && (profile?.avatar_url || profile?.full_name || profile?.email)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() }
      }}
      aria-current={active ? 'true' : undefined}
      className={`group/row relative h-7 w-full px-2 mx-2 rounded-md flex items-center gap-2 cursor-pointer text-left ${
        active
          ? 'bg-[var(--chat-accent,#4f46e5)] text-white'
          : unread
            ? 'text-white hover:bg-white/[0.06]'
            : 'text-white/70 hover:bg-white/[0.06]'
      }`}
    >
      {/* Leading icon slot: # for channels, avatar+dot (or bare dot) for DMs. */}
      <span className="w-5 shrink-0 grid place-items-center text-[15px] leading-none">
        {isDm ? (
          showAvatar ? (
            <DmAvatar profile={profile} online={online} status={status} />
          ) : (
            <PresenceDot online={online} status={status} className="ring-0" />
          )
        ) : (
          <span className={active ? 'text-white/80' : 'text-white/40'}>#</span>
        )}
      </span>

      <span className={`flex-1 min-w-0 truncate text-[15px] ${unread ? 'font-bold' : ''}`}>
        {label}
      </span>

      {/* Trailing slot: mention badge + hover action buttons (star, then ×).
          All share the right side via ml-auto on the wrapper so they sit side
          by side without overlap. The mention badge hides on hover when there
          are actions, so the buttons take the space (Slack parity). */}
      <span className="ml-auto shrink-0 flex items-center gap-0.5">
        {(() => {
          // Mentions take visual precedence (slack-mention color); otherwise a
          // plain red unread count pill. Same slot → hides on hover when row
          // actions (star/×) are present, so the buttons take the space.
          const badgeValue = mentionCount > 0 ? mentionCount : unreadCount
          if (badgeValue <= 0) return null
          const isMention = mentionCount > 0
          return (
            <span
              className={`min-w-[18px] h-[18px] px-1.5 rounded-full text-white text-[12px] font-bold grid place-items-center ${
                isMention ? 'bg-slack-mention' : 'bg-red-500'
              } ${(onToggleStar || onHide) ? 'group-hover/row:hidden' : ''}`}
            >
              {badgeValue > 99 ? '99+' : badgeValue}
            </span>
          )
        })()}

        {onToggleStar && (
          <button
            type="button"
            aria-label={starred ? `Unstar ${label || 'conversation'}` : `Star ${label || 'conversation'}`}
            aria-pressed={starred}
            title={starred ? 'Unstar' : 'Star'}
            onClick={(e) => { e.stopPropagation(); onToggleStar() }}
            className={`shrink-0 grid place-items-center w-5 h-5 rounded hover:text-white hover:bg-white/10 focus:opacity-100 focus:outline-none ${
              starred
                ? 'text-yellow-400 opacity-100'
                : 'text-white/50 opacity-0 group-hover/row:opacity-100'
            }`}
          >
            <Star className={`w-3.5 h-3.5 ${starred ? 'fill-current' : ''}`} />
          </button>
        )}

        {onHide && (
          <button
            type="button"
            aria-label={`Close ${label || 'conversation'}`}
            title="Close"
            onClick={(e) => { e.stopPropagation(); onHide() }}
            className="mr-1 shrink-0 grid place-items-center w-5 h-5 rounded text-white/50 hover:text-white hover:bg-white/10 opacity-0 group-hover/row:opacity-100 focus:opacity-100 focus:outline-none"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </span>
    </div>
  )
}
