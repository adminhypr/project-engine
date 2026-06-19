import { useEffect } from 'react'
import { BASE_TITLE, setBaseTitle } from '../lib/tabTitle'

// Sets the browser tab title for the current page; restores the base title
// on unmount so stale titles never linger after navigation.
//
// Goes through the shared tabTitle module so the unread-count prefix from
// useUnreadTabBadge composes with the per-page title instead of clobbering it.
export function usePageTitle(title) {
  useEffect(() => {
    setBaseTitle(title ? `${title} — ${BASE_TITLE}` : BASE_TITLE)
    return () => { setBaseTitle(BASE_TITLE) }
  }, [title])
}
