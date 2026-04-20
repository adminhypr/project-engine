import { useEffect } from 'react'

// Fires the callback every time the tab becomes visible again.
// Used by chat + task hooks to rehydrate state after sleep/inactivity, since
// the Supabase realtime socket can silently drop during long idle periods.
export function useDocumentVisible(onVisible) {
  useEffect(() => {
    if (typeof document === 'undefined') return
    function handler() {
      if (document.visibilityState === 'visible') onVisible?.()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [onVisible])
}
