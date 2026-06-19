import { useEffect, useRef, useState } from 'react'
import { Home, MessageSquare, Plus, LogOut, Pencil, Hash } from 'lucide-react'

// 68px fixed dark rail for the Slack-style /chat takeover (design Task 1.4).
// Pure presentation — all data comes through props. Reused presence comes in
// as the `presenceOnline` boolean (computed by the parent from the presence
// Map keyed by user id).
//
// Props:
//   active           — id of the active nav item ('home' | 'dms')
//   onSelect(id)     — nav item click ('home' | 'dms')
//   profile          — current user profile ({ full_name, email, avatar_url })
//   presenceOnline    — boolean, drives the avatar presence dot
//   onBackToApp      — click the "← App" affordance (navigates to /my-tasks)
//   onNewMessage     — "+" menu → New message (switch to DMs + focus search)
//   onNewChannel     — "+" menu → New channel (open CreateGroupModal). When
//                      undefined (externals), the menu item is omitted.

const NAV_ITEMS = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'dms', label: 'DMs', Icon: MessageSquare },
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

export default function WorkspaceRail({
  active,
  onSelect,
  profile,
  presenceOnline = false,
  onBackToApp,
  onNewMessage,
  onNewChannel,
}) {
  const initial = (profile?.full_name || profile?.email || '?').charAt(0).toUpperCase()

  // Create "+" popover menu — closes on outside-click / Escape.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuWrapRef = useRef(null)
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target)) setMenuOpen(false)
    }
    const onKeyDown = (e) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const handleNewMessage = () => { setMenuOpen(false); onNewMessage?.() }
  const handleNewChannel = () => { setMenuOpen(false); onNewChannel?.() }

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
      <div className="relative mt-1" ref={menuWrapRef}>
        <button
          type="button"
          onClick={() => setMenuOpen(o => !o)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="w-10 h-10 rounded-full grid place-items-center text-white/80 bg-white/10 hover:bg-white/20 transition-colors"
          aria-label="Create new"
          title="Create new"
        >
          <Plus className="w-5 h-5" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            aria-label="Create"
            className="absolute left-full top-0 ml-2 z-20 w-44 rounded-lg bg-white dark:bg-dark-card shadow-elevated border border-slate-200 dark:border-dark-border py-1"
          >
            <button
              type="button"
              role="menuitem"
              onClick={handleNewMessage}
              aria-label="New message"
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
            >
              <Pencil className="w-4 h-4 shrink-0" />
              New message
            </button>
            {onNewChannel && (
              <button
                type="button"
                role="menuitem"
                onClick={handleNewChannel}
                aria-label="New channel"
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
              >
                <Hash className="w-4 h-4 shrink-0" />
                New channel
              </button>
            )}
          </div>
        )}
      </div>

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
