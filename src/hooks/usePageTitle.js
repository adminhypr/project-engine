import { useEffect } from 'react'

const BASE_TITLE = 'Hypr Task'

// Sets the browser tab title for the current page; restores the base title
// on unmount so stale titles never linger after navigation.
export function usePageTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} — ${BASE_TITLE}` : BASE_TITLE
    return () => { document.title = BASE_TITLE }
  }, [title])
}
