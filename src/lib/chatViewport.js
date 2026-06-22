// Pure helper for useVisualViewportHeight: maps a VisualViewport-like object to
// the px string we store in the --chat-vh CSS custom property. Extracted so the
// rounding/guard logic is unit-tested without a DOM.
export function chatViewportHeightPx(vv) {
  if (!vv || typeof vv.height !== 'number') return null
  return `${Math.round(vv.height)}px`
}
