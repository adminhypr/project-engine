import { useEffect, useRef } from 'react'

// Fires the callback when the tab becomes visible AGAIN after having been
// hidden long enough that we might have missed a WebSocket frame.
//
// Browsers keep WebSocket connections alive for short hidden windows (alt-
// tab pop-overs, OS notifications stealing focus, the user clicking on
// another window for a couple seconds). For those cases, the realtime bus
// has already delivered every event in real time and a refetch on visible
// is pure waste — and worse, it visibly perturbs whatever the user was
// looking at by re-fetching + re-rendering when nothing changed.
//
// We only resync when the tab has been hidden for more than HIDDEN_THRESHOLD
// milliseconds (default 60s — long enough for the OS to drop the socket on
// macOS/iOS or for the laptop to sleep, short enough that we still recover
// missed events promptly when the user does come back from a real absence).
const HIDDEN_THRESHOLD = 60_000

export function useDocumentVisible(onVisible) {
  const hiddenAtRef = useRef(null)
  useEffect(() => {
    if (typeof document === 'undefined') return
    // If the tab was already hidden when this effect mounted, prime the
    // timer so an immediate visible tick still triggers a resync.
    if (document.visibilityState === 'hidden') {
      hiddenAtRef.current = Date.now()
    }
    function handler() {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now()
        return
      }
      const since = hiddenAtRef.current
      hiddenAtRef.current = null
      if (since == null) return
      const elapsed = Date.now() - since
      if (elapsed < HIDDEN_THRESHOLD) {
        if (typeof window !== 'undefined' && window.__pe_debug) {
          // eslint-disable-next-line no-console
          console.log(`[pe-debug] useDocumentVisible: skipped resync (hidden ${elapsed}ms < ${HIDDEN_THRESHOLD}ms)`)
        }
        return
      }
      onVisible?.()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [onVisible])
}
