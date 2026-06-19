import { useCallback, useEffect, useState } from 'react'
import { getPrefs, setPref as storeSetPref, subscribe } from '../lib/chatPrefs'

// Subscribe a component to the module-level chat prefs store for a given
// profile. Returns [prefs, setPref]. Re-renders whenever any prefs change is
// notified (re-reads the full prefs for the active profile). setPref is stable
// across renders. Tolerates a missing profileId (returns DEFAULTS, setPref is a
// no-op at the store level).
export function useChatPrefs(profileId) {
  const [prefs, setPrefs] = useState(() => getPrefs(profileId))

  useEffect(() => {
    // Resync on profile change.
    setPrefs(getPrefs(profileId))
    const unsub = subscribe(({ profileId: changed }) => {
      // Re-read for this profile on any change to it (or global notifications).
      if (!changed || changed === profileId) {
        setPrefs(getPrefs(profileId))
      }
    })
    return unsub
  }, [profileId])

  const setPref = useCallback((key, value) => {
    storeSetPref(profileId, key, value)
  }, [profileId])

  return [prefs, setPref]
}
