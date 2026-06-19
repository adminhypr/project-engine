// Module-level chat preferences store (mirrors dmSoundContext / dmEventBus —
// NOT a React context) so both the /chat takeover and the floating widget read
// the same prefs without provider restructuring. Persists per profile in
// localStorage under `pe-chat-prefs-{profileId}`. No DB.
//
// See docs/plans/2026-06-19-chat-preferences.md for keys/defaults/presets.

const PREFIX = 'pe-chat-prefs-'

export const DEFAULTS = Object.freeze({
  theme: 'system', // 'system' | 'light' | 'dark' — delegates to useTheme
  sidebarTheme: 'default', // 'default'|'aubergine'|'ocean'|'forest'|'sunset'
  density: 'comfortable', // 'comfortable' | 'compact'
  timeFormat: '12h', // '12h' | '24h'
  toolbarDefault: false, // composer toolbar hidden by default
  sendOnEnter: true, // Enter sends; false => Cmd/Ctrl+Enter sends
  sound: true, // new-message ping
  desktopNotifications: false, // browser Notification
  dmListShowAll: false, // recent only; true => show everyone
})

// Sidebar theme presets — each supplies the 3 CSS vars applied to the chat root
// (and widget root) when sidebarTheme changes. Wiring of the vars happens in a
// separate task; the store/panel only need the values to render swatches.
export const SIDEBAR_THEMES = Object.freeze({
  default: { label: 'Default', sidebar: '#1a1d24', sidebar2: '#15171d', accent: '#4f46e5' },
  aubergine: { label: 'Aubergine', sidebar: '#3f0e40', sidebar2: '#350d36', accent: '#611f69' },
  ocean: { label: 'Ocean', sidebar: '#0b2540', sidebar2: '#07203b', accent: '#2563eb' },
  forest: { label: 'Forest', sidebar: '#14302a', sidebar2: '#0f2620', accent: '#15803d' },
  sunset: { label: 'Sunset', sidebar: '#3a1a12', sidebar2: '#2e140d', accent: '#c2410c' },
})

function keyFor(profileId) {
  return `${PREFIX}${profileId}`
}

function getStorage() {
  try {
    return globalThis.localStorage || null
  } catch {
    return null
  }
}

// Returns the full prefs object: stored values merged over DEFAULTS. Tolerates
// a missing profileId and corrupt JSON (falls back to DEFAULTS). Unknown stored
// keys are dropped so the shape stays stable.
export function getPrefs(profileId) {
  const storage = getStorage()
  if (!profileId || !storage) return { ...DEFAULTS }
  let stored = null
  try {
    const raw = storage.getItem(keyFor(profileId))
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        stored = parsed
      }
    }
  } catch {
    stored = null
  }
  const merged = { ...DEFAULTS }
  if (stored) {
    for (const k of Object.keys(DEFAULTS)) {
      if (k in stored) merged[k] = stored[k]
    }
  }
  return merged
}

// Persist a single pref and notify subscribers. No-op when profileId/storage
// missing or key isn't a known pref.
export function setPref(profileId, key, value) {
  if (!profileId || !(key in DEFAULTS)) return
  const storage = getStorage()
  if (!storage) return
  const next = { ...getPrefs(profileId), [key]: value }
  // Persist only the known keys.
  const toStore = {}
  for (const k of Object.keys(DEFAULTS)) toStore[k] = next[k]
  try {
    storage.setItem(keyFor(profileId), JSON.stringify(toStore))
  } catch {
    /* quota / disabled storage — non-fatal */
  }
  notify(profileId, key, value)
}

// ── Subscription ─────────────────────────────
const subscribers = new Set()

export function subscribe(cb) {
  if (typeof cb !== 'function') return () => {}
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

function notify(profileId, key, value) {
  for (const cb of subscribers) {
    try {
      cb({ profileId, key, value })
    } catch {
      /* a misbehaving subscriber shouldn't break the rest */
    }
  }
}
