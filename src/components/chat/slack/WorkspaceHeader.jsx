import { useEffect, useRef, useState } from 'react'
import { ChevronDown, PenSquare, UserPlus, Settings, ArrowLeft, LogOut, Check } from 'lucide-react'
import { signOut } from '../../../lib/auth'
import PresenceDot from '../PresenceDot'

// Status choices for the workspace dropdown. On mobile the rail (which owns the
// avatar status menu on desktop) is hidden, so this is the only way to set
// status on a phone. 'active' maps to the 'auto' override (resume automatic idle
// detection), mirroring WorkspaceRail's STATUS_OPTIONS.
const STATUS_CHOICES = [
  { value: 'active', label: 'Active', status: 'active' },
  { value: 'away', label: 'Away', status: 'away' },
  { value: 'offline', label: 'Appear offline', status: 'offline' },
]

// Slack-style workspace header for the channel sidebar (design Task 1.5).
// Workspace name + chevron dropdown + compose pencil. Pure presentation aside
// from the auth signOut (mirrors Layout.jsx's `signOut()` from lib/auth).
//
// Props:
//   name             — workspace name (default "Project Engine")
//   onCompose        — compose pencil click (new message / group)
//   onInvite         — "Invite people" menu item (optional)
//   onPreferences    — "Preferences" menu item (optional)
//   onBackToApp      — "← Back to Project Engine" menu item

export default function WorkspaceHeader({
  name = 'Project Engine',
  onCompose,
  onInvite,
  onPreferences,
  onBackToApp,
  manualStatus = 'auto',
  onSetStatus,
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const handleSignOut = async () => {
    setOpen(false)
    await signOut()
  }

  const menuItem = (Icon, label, onClick) => (
    <button
      type="button"
      onClick={() => { setOpen(false); onClick?.() }}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 text-left"
    >
      <Icon className="w-4 h-4 shrink-0 text-slate-400" />
      <span className="truncate">{label}</span>
    </button>
  )

  return (
    <div className="relative h-12 px-3 flex items-center justify-between border-b border-white/10" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex items-center gap-1 min-w-0 text-white hover:bg-white/5 rounded px-1.5 py-1 -ml-1.5"
      >
        <span className="text-[18px] font-black truncate">{name}</span>
        <ChevronDown className="w-4 h-4 shrink-0" />
      </button>

      <button
        type="button"
        onClick={onCompose}
        className="shrink-0 w-8 h-8 rounded-lg grid place-items-center text-white bg-white/10 hover:bg-white/20 transition-colors"
        aria-label="Compose"
        title="New message"
      >
        <PenSquare className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute left-2 top-12 z-50 w-60 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card shadow-elevated py-1 overflow-hidden">
          {onSetStatus && (
            <>
              <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Set yourself as
              </div>
              {STATUS_CHOICES.map(opt => {
                const selected = (manualStatus === 'auto' ? 'active' : manualStatus) === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { setOpen(false); onSetStatus(opt.value === 'active' ? 'auto' : opt.value) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 text-left"
                  >
                    <PresenceDot status={opt.status} className="!ring-0 !w-2.5 !h-2.5 shrink-0" />
                    <span className="flex-1 truncate">{opt.label}</span>
                    {selected && <Check className="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0" />}
                  </button>
                )
              })}
              <div className="my-1 border-t border-slate-200 dark:border-dark-border" />
            </>
          )}
          {menuItem(UserPlus, 'Invite people', onInvite)}
          {menuItem(Settings, 'Preferences', onPreferences)}
          <div className="my-1 border-t border-slate-200 dark:border-dark-border" />
          {menuItem(ArrowLeft, 'Back to Project Engine', onBackToApp)}
          {menuItem(LogOut, 'Sign out', handleSignOut)}
        </div>
      )}
    </div>
  )
}
