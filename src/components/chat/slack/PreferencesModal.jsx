import { SlidersHorizontal, X, Check } from 'lucide-react'
import { ModalWrapper } from '../../ui/animations'
import { showToast } from '../../ui'
import { useChatPrefs } from '../../../hooks/useChatPrefs'
import { useTheme } from '../../../hooks/useTheme'
import { SIDEBAR_THEMES } from '../../../lib/chatPrefs'

// Chat Preferences panel (design: docs/plans/2026-06-19-chat-preferences.md).
// Reads/writes the module-level chatPrefs store via useChatPrefs so values
// reflect live. The actual effects (density/sidebar/sound/etc.) are wired into
// consuming components in a SEPARATE task — EXCEPT the Theme control, which
// drives the real app theme through useTheme, and the desktop-notifications
// permission request. Opened from WorkspaceHeader → ChannelSidebar → ChatPage.
//
// Props: { open, onClose, profileId }
export default function PreferencesModal({ open, onClose, profileId }) {
  const [prefs, setPref] = useChatPrefs(profileId)
  const theme = useTheme()

  // Theme delegates to the real theme system. useTheme exposes { dark, toggle }
  // with persistence in `pe-theme`. We add 'system' support here: choosing
  // System clears the override and follows prefers-color-scheme; Light/Dark set
  // it explicitly. We mirror the selection into the prefs store so the panel
  // shows the right segment.
  const applyTheme = (next) => {
    setPref('theme', next)
    if (next === 'system') {
      try {
        localStorage.removeItem('pe-theme')
      } catch { /* noop */ }
      const prefersDark = typeof window !== 'undefined'
        && window.matchMedia('(prefers-color-scheme: dark)').matches
      // useTheme only flips via toggle(); align it to the system preference.
      if (prefersDark !== theme.dark) theme.toggle()
      // toggle() will re-persist pe-theme; clear it again so it stays "system".
      try {
        localStorage.removeItem('pe-theme')
      } catch { /* noop */ }
    } else {
      const wantDark = next === 'dark'
      if (wantDark !== theme.dark) theme.toggle()
    }
  }

  // The Theme segment reflects the explicit stored choice if set; otherwise the
  // live dark/light state. Default pref is 'system'.
  const themeValue = prefs.theme || 'system'

  const handleDesktopNotifications = async (turnOn) => {
    if (!turnOn) {
      setPref('desktopNotifications', false)
      return
    }
    // Turning ON — request browser permission first.
    if (typeof Notification === 'undefined') {
      showToast('Desktop notifications are not supported in this browser', 'error')
      return
    }
    try {
      let perm = Notification.permission
      if (perm === 'default') perm = await Notification.requestPermission()
      if (perm === 'granted') {
        setPref('desktopNotifications', true)
      } else {
        // Denied / dismissed — revert (stays off) and tell the user.
        setPref('desktopNotifications', false)
        showToast('Desktop notifications are blocked in your browser settings', 'error')
      }
    } catch {
      setPref('desktopNotifications', false)
      showToast('Could not enable desktop notifications', 'error')
    }
  }

  return (
    <ModalWrapper isOpen={open} onClose={onClose}>
      <div className="flex flex-col max-h-[85vh]">
        <header className="px-4 py-3 border-b border-slate-200 dark:border-dark-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-brand-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Chat preferences</h2>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-4 space-y-6 overflow-y-auto">
          {/* ── Appearance ─────────────────────────── */}
          <Section title="Appearance">
            <Row label="Theme">
              <SegmentedControl
                value={themeValue}
                onChange={applyTheme}
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'system', label: 'System' },
                ]}
              />
            </Row>

            <Row label="Sidebar theme" stacked>
              <div className="flex items-center gap-2.5">
                {Object.entries(SIDEBAR_THEMES).map(([key, t]) => {
                  const selected = prefs.sidebarTheme === key
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setPref('sidebarTheme', key)}
                      title={t.label}
                      aria-label={t.label}
                      aria-pressed={selected}
                      className={`relative w-12 h-12 rounded-lg overflow-hidden border border-black/10 dark:border-white/10 transition ${
                        selected ? 'ring-2 ring-offset-2 ring-brand-500 dark:ring-offset-dark-card' : 'hover:scale-105'
                      }`}
                    >
                      {/* two-tone sidebar/rail split + accent dot */}
                      <span className="absolute inset-0 flex">
                        <span className="w-1/3 h-full" style={{ background: t.sidebar2 }} />
                        <span className="w-2/3 h-full" style={{ background: t.sidebar }} />
                      </span>
                      <span
                        className="absolute bottom-1.5 right-1.5 w-3.5 h-3.5 rounded-full border border-white/30"
                        style={{ background: t.accent }}
                      />
                      {selected && (
                        <span className="absolute top-1 left-1 text-white drop-shadow">
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </Row>

            <Row label="Message density">
              <SegmentedControl
                value={prefs.density}
                onChange={(v) => setPref('density', v)}
                options={[
                  { value: 'comfortable', label: 'Comfortable' },
                  { value: 'compact', label: 'Compact' },
                ]}
              />
            </Row>

            <Row label="Time format">
              <SegmentedControl
                value={prefs.timeFormat}
                onChange={(v) => setPref('timeFormat', v)}
                options={[
                  { value: '12h', label: '12h' },
                  { value: '24h', label: '24h' },
                ]}
              />
            </Row>

            <Row label="Show formatting toolbar by default">
              <Toggle checked={prefs.toolbarDefault} onChange={(v) => setPref('toolbarDefault', v)} />
            </Row>
          </Section>

          {/* ── Behavior ───────────────────────────── */}
          <Section title="Behavior">
            <Row label="Send messages on Enter">
              <SegmentedControl
                value={prefs.sendOnEnter ? 'enter' : 'cmd'}
                onChange={(v) => setPref('sendOnEnter', v === 'enter')}
                options={[
                  { value: 'enter', label: 'Enter sends' },
                  { value: 'cmd', label: 'Cmd+Enter sends' },
                ]}
              />
            </Row>

            <Row label="New-message sound">
              <Toggle checked={prefs.sound} onChange={(v) => setPref('sound', v)} />
            </Row>

            <Row label="Desktop notifications">
              <Toggle checked={prefs.desktopNotifications} onChange={handleDesktopNotifications} />
            </Row>

            <Row label="Default DM list">
              <SegmentedControl
                value={prefs.dmListShowAll ? 'all' : 'recent'}
                onChange={(v) => setPref('dmListShowAll', v === 'all')}
                options={[
                  { value: 'recent', label: 'Recent only' },
                  { value: 'all', label: 'Everyone' },
                ]}
              />
            </Row>
          </Section>
        </div>
      </div>
    </ModalWrapper>
  )
}

// ── inline reusable subcomponents ───────────────
function Section({ title, children }) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Row({ label, children, stacked = false }) {
  return (
    <div className={stacked ? 'space-y-2' : 'flex items-center justify-between gap-4'}>
      <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
      <div className={stacked ? '' : 'shrink-0'}>{children}</div>
    </div>
  )
}

function SegmentedControl({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 gap-0.5">
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            className={`px-3 py-1 rounded-md text-xs font-medium transition whitespace-nowrap ${
              active
                ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        checked ? 'bg-brand-500' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
