import { useEffect, useRef, useState } from 'react'
import { Home, MessageSquare, Plus, LogOut, Pencil, Hash, Check } from 'lucide-react'
import PresenceDot from '../PresenceDot'

// 68px fixed dark rail for the Slack-style /chat takeover (design Task 1.4).
// Pure presentation — all data comes through props.
//
// Props:
//   active           — id of the active nav item ('home' | 'dms')
//   onSelect(id)     — nav item click ('home' | 'dms')
//   profile          — current user profile ({ full_name, email, avatar_url })
//   selfStatus       — the current user's DISPLAY status ('active'|'away'|
//                      'offline') for the avatar dot. Self is excluded from the
//                      presence Map, so the parent derives this from the manual
//                      override store.
//   manualStatus     — the raw manual override ('auto'|'active'|'away'|
//                      'offline'); drives the check mark in the status menu.
//   onSetStatus(v)   — set the manual override ('auto'|'active'|'away'|'offline').
//   onBackToApp      — click the "← App" affordance (navigates to /my-tasks)
//   onNewMessage     — "+" menu → New message (switch to DMs + focus search)
//   onNewChannel     — "+" menu → New channel (open CreateGroupModal). When
//                      undefined (externals), the menu item is omitted.

const NAV_ITEMS = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'dms', label: 'DMs', Icon: MessageSquare },
]

// Status menu options. 'active' clears the override (sets 'auto') so automatic
// idle detection resumes — matching Slack's "Active" which is the default
// auto-managed state; explicit Away / Appear offline are hard overrides.
const STATUS_OPTIONS = [
  { value: 'active', label: 'Active', status: 'active' },
  { value: 'away', label: 'Away', status: 'away' },
  { value: 'offline', label: 'Appear offline', status: 'offline' },
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
  selfStatus = 'active',
  manualStatus = 'auto',
  onSetStatus,
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

  // Status popover on the avatar — closes on outside-click / Escape.
  const [statusOpen, setStatusOpen] = useState(false)
  const statusWrapRef = useRef(null)
  useEffect(() => {
    if (!statusOpen) return
    const onPointerDown = (e) => {
      if (statusWrapRef.current && !statusWrapRef.current.contains(e.target)) setStatusOpen(false)
    }
    const onKeyDown = (e) => { if (e.key === 'Escape') setStatusOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [statusOpen])

  const handleNewMessage = () => { setMenuOpen(false); onNewMessage?.() }
  const handleNewChannel = () => { setMenuOpen(false); onNewChannel?.() }

  // 'Active' maps to the 'auto' override (resume automatic idle detection);
  // Away / Appear offline are hard overrides. The check mark reflects the raw
  // manual override: 'auto' is treated as "Active" selected.
  const handleSetStatus = (opt) => {
    setStatusOpen(false)
    const overrideValue = opt.value === 'active' ? 'auto' : opt.value
    onSetStatus?.(overrideValue)
  }
  const selectedValue = manualStatus === 'auto' ? 'active' : manualStatus
  const displayName = profile?.full_name || profile?.email || 'You'
  const currentLabel = STATUS_OPTIONS.find(o => o.value === selectedValue)?.label || 'Active'

  return (
    <nav
      className="bg-[var(--chat-sidebar-2,#15171d)] w-[68px] h-full flex flex-col items-center py-3 gap-1 shrink-0"
      aria-label="Workspace"
    >
      {/* Workspace icon */}
      <div
        className="w-9 h-9 rounded-lg text-white font-black grid place-items-center mb-2 shadow-card bg-[var(--chat-accent,#4f46e5)]"
      >
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

      {/* Bottom: avatar (opens status menu) + back-to-app */}
      <div className="mt-auto flex flex-col items-center gap-2">
        <div className="relative" ref={statusWrapRef}>
          <button
            type="button"
            onClick={() => setStatusOpen(o => !o)}
            aria-haspopup="menu"
            aria-expanded={statusOpen}
            aria-label={`Set your status — currently ${currentLabel}`}
            title={`${displayName} — ${currentLabel}`}
            className="relative w-9 h-9 block rounded-lg focus:outline-none focus:ring-2 focus:ring-white/40"
          >
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="w-9 h-9 rounded-lg object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 font-semibold grid place-items-center">
                {initial}
              </div>
            )}
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-slack-sidebar-2 ${
                selfStatus === 'active'
                  ? 'bg-slack-presence'
                  : selfStatus === 'away'
                    ? 'bg-transparent ring-amber-400'
                    : 'bg-slate-500'
              }`}
              aria-hidden="true"
            />
          </button>

          {statusOpen && (
            <div
              role="menu"
              aria-label="Set your status"
              className="absolute left-full bottom-0 ml-2 z-30 w-56 rounded-lg bg-white dark:bg-dark-card shadow-elevated border border-slate-200 dark:border-dark-border py-1"
            >
              <div className="px-3 py-2 border-b border-slate-100 dark:border-dark-border">
                <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">{displayName}</div>
                <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  <PresenceDot status={selfStatus} className="!ring-0 !w-2 !h-2" />
                  {currentLabel}
                </div>
              </div>
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedValue === opt.value}
                  onClick={() => handleSetStatus(opt)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                >
                  <PresenceDot status={opt.status} className="!ring-0 !w-2.5 !h-2.5 shrink-0" />
                  <span className="flex-1 text-left">{opt.label}</span>
                  {selectedValue === opt.value && <Check className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />}
                </button>
              ))}
            </div>
          )}
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
