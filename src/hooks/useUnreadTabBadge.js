import { useEffect } from 'react'
import { useTotalUnread } from './useTotalUnread'
import { setUnreadCount } from '../lib/tabTitle'

// Mount ONCE (in AuthProvider). Drives two tab-level unread signals:
//   1. Title prefix: "(3) Chat — Hypr Task" via the shared tabTitle module
//      (composes with usePageTitle — see src/lib/tabTitle.js).
//   2. Favicon dot: redraws the existing favicon onto a canvas with a small red
//      circle in the corner. Degrades gracefully — if the favicon can't be
//      drawn (CORS-tainted canvas, SVG, load failure) we skip the favicon part;
//      the title prefix remains the reliable signal.

function findIconLink() {
  return (
    document.querySelector("link[rel='icon']") ||
    document.querySelector("link[rel~='icon']")
  )
}

export function useUnreadTabBadge() {
  const total = useTotalUnread()

  // Title prefix — cheap, always applied.
  useEffect(() => {
    setUnreadCount(total)
    return () => { setUnreadCount(0) }
  }, [total])

  // Favicon dot.
  useEffect(() => {
    const link = findIconLink()
    if (!link) return
    const originalHref = link.getAttribute('href')

    if (total <= 0) {
      // Nothing unread — make sure we're showing the original icon.
      if (originalHref && link.dataset.peBadged === 'true') {
        link.setAttribute('href', link.dataset.peOriginalHref || originalHref)
        delete link.dataset.peBadged
      }
      return
    }

    let cancelled = false
    const baseHref = link.dataset.peOriginalHref || originalHref
    if (!baseHref) return

    const img = new Image()
    // Same-origin favicon (served from /public) — no crossOrigin needed and
    // setting it could taint if the server lacks CORS headers. Wrap draw in
    // try/catch so a tainted canvas (SecurityError) just no-ops.
    img.onload = () => {
      if (cancelled) return
      try {
        const size = 64
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, size, size)
        // Red dot, top-right corner, with a white ring so it reads on any icon.
        const r = size * 0.22
        const cx = size - r - 2
        const cy = r + 2
        ctx.beginPath()
        ctx.arc(cx, cy, r + 2, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = '#ef4444' // tailwind red-500
        ctx.fill()
        const dataUrl = canvas.toDataURL('image/png')
        if (cancelled) return
        link.dataset.peOriginalHref = baseHref
        link.dataset.peBadged = 'true'
        link.setAttribute('href', dataUrl)
      } catch {
        // Tainted canvas / unsupported — title prefix is the fallback signal.
      }
    }
    img.onerror = () => { /* favicon failed to load — skip the dot */ }
    img.src = baseHref

    return () => {
      cancelled = true
    }
  }, [total])

  // Final restore on unmount.
  useEffect(() => {
    return () => {
      const link = findIconLink()
      if (link && link.dataset.peBadged === 'true') {
        link.setAttribute('href', link.dataset.peOriginalHref || link.getAttribute('href'))
        delete link.dataset.peBadged
      }
    }
  }, [])
}
