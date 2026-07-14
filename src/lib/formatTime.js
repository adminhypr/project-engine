// Centralized chat timestamp formatter so the time-format preference (12h/24h)
// is honored consistently across message components. Pure (no React) so it's
// unit-testable. Existing callers used
// `new Date(iso).toLocaleTimeString([], { hour: '2-digit'|'numeric', minute: '2-digit' })`
// — this preserves that output for the default ('12h') and adds a 24h branch.

// fmt: '12h' (default) → '2:40 PM' / '12:00 AM'; '24h' → '14:40' / '00:00'.
export function formatChatTime(iso, fmt = '12h') {
  try {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    // Locale pinned to en-US: the promised outputs ('2:40 PM', '00:00') are
    // locale-dependent — e.g. en-CA renders '2:40 p.m.' — and the 12h/24h
    // toggle is the user-facing preference, not the browser locale.
    if (fmt === '24h') {
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    }
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  } catch {
    return ''
  }
}
