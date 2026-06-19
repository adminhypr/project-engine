// Module-level manual-presence-status store (mirrors chatPrefs / dmSoundContext —
// NOT a React context) so the /chat takeover, the floating widget, and the
// global presence channel all read the same manual override without provider
// restructuring. Persists per profile in localStorage under
// `pe-presence-status-{profileId}`. No DB — this is a frontend-only concept
// broadcast over the existing Supabase Realtime presence channel.
//
// Values:
//   'auto'    — no override; the presence channel falls back to its automatic
//               behavior (active when visible+active, away when idle, offline
//               when the tab is hidden).
//   'active'  — always broadcast active (even if idle).
//   'away'    — always broadcast away.
//   'offline' — appear offline (still connected, but broadcast offline).

const PREFIX = 'pe-presence-status-'

export const STATUS_VALUES = Object.freeze(['auto', 'active', 'away', 'offline'])
export const DEFAULT_STATUS = 'auto'

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

function isValid(v) {
  return STATUS_VALUES.includes(v)
}

// Returns the stored manual status for a profile, or DEFAULT_STATUS ('auto').
// Tolerates a missing profileId, missing storage, and corrupt/unknown values.
export function getStatus(profileId) {
  const storage = getStorage()
  if (!profileId || !storage) return DEFAULT_STATUS
  try {
    const raw = storage.getItem(keyFor(profileId))
    if (raw && isValid(raw)) return raw
  } catch {
    /* corrupt / disabled storage — fall through to default */
  }
  return DEFAULT_STATUS
}

// Persist the manual status and notify subscribers. No-op when
// profileId/storage missing or the value isn't a known status.
export function setStatus(profileId, value) {
  if (!profileId || !isValid(value)) return
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(keyFor(profileId), value)
  } catch {
    /* quota / disabled storage — non-fatal */
  }
  notify(profileId, value)
}

// Resolve the EFFECTIVE broadcast status given the manual override and the
// current automatic signals. Pure — used by the presence channel.
//   override 'active'  → 'active'
//   override 'away'    → 'away'
//   override 'offline' → 'offline'
//   override 'auto'    → 'active' when visible+active, 'away' when idle,
//                        'offline' when hidden (driven by `autoStatus`).
export function effectiveStatus(override, autoStatus) {
  if (override === 'active' || override === 'away' || override === 'offline') {
    return override
  }
  // 'auto' / unknown → defer to the automatic signal.
  return isValid(autoStatus) && autoStatus !== 'auto' ? autoStatus : 'offline'
}

// ── Subscription ─────────────────────────────
const subscribers = new Set()

export function subscribe(cb) {
  if (typeof cb !== 'function') return () => {}
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

function notify(profileId, value) {
  for (const cb of subscribers) {
    try {
      cb({ profileId, value })
    } catch {
      /* a misbehaving subscriber shouldn't break the rest */
    }
  }
}
