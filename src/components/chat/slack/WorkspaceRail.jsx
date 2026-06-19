import { Home, MessageSquare, Bell, Bookmark, MoreHorizontal, Plus, LogOut } from 'lucide-react'

// 68px fixed dark rail for the Slack-style /chat takeover (design Task 1.4).
// Pure presentation — all data comes through props. Reused presence comes in
// as the `presenceOnline` boolean (computed by the parent from the presence
// Map keyed by user id).
//
// Props:
//   active           — id of the active nav item ('home' | 'dms' | 'activity' | 'later' | 'more')
//   onSelect(id)     — nav item click
//   profile          — current user profile ({ full_name, email, avatar_url })
//   presenceOnline    — boolean, drives the avatar presence dot
//   onBackToApp      — click the "← App" affordance (navigates to /my-tasks)

const NAV_ITEMS = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'dms', label: 'DMs', Icon: MessageSquare },
  { id: 'activity', label: 'Activity', Icon: Bell },
  { id: 'later', label: 'Later', Icon: Bookmark },
  { id: 'more', label: 'More', Icon: MoreHorizontal },
]

function NavButton({ item, active, onSelect }) {
  const { id, label, Icon } = item
  return (
    <button
      type="button"
      onClick={() => onSelect?.(id)}
      aria-current={active ? 'true' : undefined}
      className={`w-12 flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-colors ${
        active ? 'bg-white/10 text-white' : 'text-white/60 hover:bg-white/5'
      }`}
      title={label}
    >
      <Icon className="w-5 h-5" />
      <span className="text-[11px] leading-none">{label}</span>
    </button>
  )
}

export default function WorkspaceRail({ active, onSelect, profile, presenceOnline = false, onBackToApp }) {
  const initial = (profile?.full_name || profile?.email || '?').charAt(0).toUpperCase()
  return (
    <nav
      className="bg-slack-sidebar-2 w-[68px] h-full flex flex-col items-center py-3 gap-1 shrink-0"
      aria-label="Workspace"
    >
      {/* Workspace icon */}
      <div className="w-9 h-9 rounded-lg bg-brand-600 text-white font-black grid place-items-center mb-2 shadow-card">
        PE
      </div>

      {/* Primary navigation */}
      <div className="flex flex-col items-center gap-1">
        {NAV_ITEMS.map(item => (
          <NavButton
            key={item.id}
            item={item}
            active={active === item.id}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/* Create */}
      <button
        type="button"
        onClick={() => onSelect?.('create')}
        className="mt-1 w-10 h-10 rounded-full grid place-items-center text-white/80 bg-white/10 hover:bg-white/20 transition-colors"
        aria-label="Create new"
        title="Create new"
      >
        <Plus className="w-5 h-5" />
      </button>

      {/* Bottom: avatar + presence + back-to-app */}
      <div className="mt-auto flex flex-col items-center gap-2">
        <div className="relative w-9 h-9">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-9 h-9 rounded-lg object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 font-semibold grid place-items-center">
              {initial}
            </div>
          )}
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-slack-sidebar-2 ${
              presenceOnline ? 'bg-slack-presence' : 'bg-slate-500'
            }`}
            aria-label={presenceOnline ? 'Online' : 'Offline'}
          />
        </div>
        <button
          type="button"
          onClick={onBackToApp}
          className="w-12 flex flex-col items-center gap-0.5 py-1.5 rounded-lg text-white/60 hover:bg-white/5 transition-colors"
          title="Back to Project Engine"
        >
          <LogOut className="w-4 h-4 rotate-180" />
          <span className="text-[11px] leading-none">App</span>
        </button>
      </div>
    </nav>
  )
}
