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

// Resolve a single effective status from ALL of a user's presence metas
// (one meta per open tab/connection). Slack-correct rule: a user is "active"
// if they're active in ANY tab; otherwise "away" if away anywhere; otherwise
// "offline". This fixes the bug where picking an arbitrary meta (e.g. a hidden
// background tab, or a stale ghost connection) made an active user show as
// away/offline to everyone else. Metas with no status field (older clients)
// count as 'active' (they only tracked while online). Returns the freshest
// online_at across metas for the display timestamp.
const STATUS_RANK = { active: 3, away: 2, offline: 1 }
export function resolvePresenceMetas(metas) {
  if (!Array.isArray(metas) || metas.length === 0) {
    return { status: 'offline', onlineAt: null }
  }
  let best = 'offline'
  let onlineAt = null
  for (const m of metas) {
    const raw = m && m.status
    const s = raw === 'away' || raw === 'offline' ? raw : 'active'
    if ((STATUS_RANK[s] || 0) > (STATUS_RANK[best] || 0)) best = s
    const at = m && m.online_at
    if (at && (!onlineAt || at > onlineAt)) onlineAt = at
  }
  return { status: best, onlineAt }
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
