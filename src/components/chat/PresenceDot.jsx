// Presence dot. Renders one of three states:
//   · active  — filled green
//   · away    — hollow amber ring (visible but idle, or manual "away")
//   · offline — solid gray
//
// `status` ('active' | 'away' | 'offline') is preferred. For backward compat
// with the many call sites that still pass only `online`, status is derived
// from the boolean when not supplied (online → active, else offline).
export default function PresenceDot({ online, status, className = '' }) {
  const resolved = status || (online ? 'active' : 'offline')

  const base = 'inline-block w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-dark-card'
  let tone
  let label
  if (resolved === 'active') {
    tone = 'bg-green-500'
    label = 'Active'
  } else if (resolved === 'away') {
    // Hollow amber ring — visually distinct from both active and offline.
    tone = 'bg-transparent !ring-amber-400 dark:!ring-amber-400'
    label = 'Away'
  } else {
    tone = 'bg-slate-300 dark:bg-slate-600'
    label = 'Offline'
  }

  return (
    <span
      className={`${base} ${tone} ${className}`}
      aria-label={label}
    />
  )
}
