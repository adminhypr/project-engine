import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useDmRealtime } from './useDmRealtime'
import { isAgent, isClient, isExternal } from '../lib/roleHelpers'
import { getStoredActiveTeamId, setStoredActiveTeamId, pickDefaultTeam } from '../lib/activeTeamStorage'

const AuthContext = createContext(null)

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Direct REST call — bypasses the Supabase JS client's auth queue
async function fetchProfileDirect(userId, accessToken) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)

  try {
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Accept-Profile': 'public',
    }

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*,teams!profiles_team_id_fkey(id,name)`,
      { headers, signal: controller.signal }
    )
    clearTimeout(timeout)

    if (!res.ok) {
      console.error('Profile fetch HTTP error:', res.status)
      return null
    }

    const rows = await res.json()
    const profile = rows?.[0] || null

    // profile_teams + manager-name resolution can run in parallel — neither
    // depends on the other. Profile-teams uses just the userId; manager
    // lookup depends on profile.reports_to from the response above. Running
    // sequentially used to add ~150-300ms to every cold start.
    if (profile) {
      const ptUrl = `${SUPABASE_URL}/rest/v1/profile_teams?profile_id=eq.${userId}&select=team_id,is_primary,role,team:teams(id,name)`
      const mgrUrl = profile.reports_to
        ? `${SUPABASE_URL}/rest/v1/profiles?id=eq.${profile.reports_to}&select=id,full_name`
        : null

      const [ptRes, mgrRes] = await Promise.all([
        fetch(ptUrl, { headers }).catch(() => null),
        mgrUrl ? fetch(mgrUrl, { headers }).catch(() => null) : Promise.resolve(null),
      ])

      try {
        if (ptRes?.ok) {
          const pt = await ptRes.json()
          if (pt.length > 0) {
            profile.team_ids = pt.map(r => r.team_id)
            profile.all_teams = pt.map(r => ({ ...r.team, is_primary: r.is_primary, role: r.role }))
            profile.team_roles = Object.fromEntries(pt.map(r => [r.team_id, r.role]))
            const primary = pt.find(r => r.is_primary)
            if (primary?.team) {
              profile.teams = primary.team
              profile.team_id = primary.team_id
            }
          } else {
            profile.team_ids = profile.team_id ? [profile.team_id] : []
            profile.all_teams = profile.teams ? [{ ...profile.teams, is_primary: true, role: profile.role === 'Admin' ? 'Manager' : profile.role }] : []
            profile.team_roles = profile.team_id ? { [profile.team_id]: profile.role === 'Admin' ? 'Manager' : profile.role } : {}
          }
        }
      } catch {
        // Non-critical
      }

      try {
        if (mgrRes?.ok) {
          const mgrRows = await mgrRes.json()
          profile.manager = mgrRows?.[0] || null
        }
      } catch {
        // Non-critical — sidebar just won't show manager name
      }
    }

    return profile
  } catch (err) {
    clearTimeout(timeout)
    console.error('Profile fetch failed:', err.name, err.message)
    return null
  }
}

export function AuthProvider({ children }) {
  const [session,  setSession]  = useState(null)
  const [profile,  setProfile]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [activeTeamId, setActiveTeamIdState] = useState(null)
  const initDone = useRef(false)

  // Cold-load used to fire fetchProfileDirect 2-3 times: once from init() and
  // once from onAuthStateChange's INITIAL_SESSION (and sometimes a 3rd from
  // a TOKEN_REFRESHED that triggered a refetch). Each fetchProfileDirect is
  // 2 round-trips minimum. Dedupe by tracking the loaded user id and the
  // in-flight promise — repeat callers return the same promise.
  const loadedUserIdRef = useRef(null)
  const inFlightRef = useRef(null)

  const loadProfile = useCallback(async (sess) => {
    if (!sess?.access_token || !sess?.user?.id) return false
    const uid = sess.user.id
    if (loadedUserIdRef.current === uid) return true
    if (inFlightRef.current?.uid === uid) return inFlightRef.current.promise
    const promise = (async () => {
      const data = await fetchProfileDirect(uid, sess.access_token)
      if (data) {
        loadedUserIdRef.current = uid
        setProfile(data)
        return true
      }
      return false
    })()
    inFlightRef.current = { uid, promise }
    try {
      return await promise
    } finally {
      if (inFlightRef.current?.promise === promise) inFlightRef.current = null
    }
  }, [])

  useEffect(() => {
    let mounted = true

    async function init() {
      // Try getSession with a timeout
      let sess = null
      try {
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ])
        sess = result?.data?.session
      } catch {
        console.warn('getSession timed out — clearing stale session')
        // Clear stale tokens manually
        const storageKey = `sb-${SUPABASE_URL.split('//')[1].split('.')[0]}-auth-token`
        localStorage.removeItem(storageKey)
        if (mounted) { setSession(null); setLoading(false) }
        return
      }

      if (!mounted) return

      if (sess) {
        // Check if token looks expired (exp is in seconds)
        const payload = JSON.parse(atob(sess.access_token.split('.')[1]))
        const isExpired = payload.exp && (Date.now() / 1000) > payload.exp

        if (isExpired) {
          console.warn('Token expired, attempting refresh...')
          try {
            const { data } = await Promise.race([
              supabase.auth.refreshSession(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
            ])
            if (data?.session) {
              sess = data.session
            } else {
              console.warn('Refresh failed, signing out')
              await supabase.auth.signOut().catch(() => {})
              if (mounted) { loadedUserIdRef.current = null; setSession(null); setProfile(null); setLoading(false) }
              return
            }
          } catch {
            console.warn('Refresh timed out, signing out')
            // Force clear
            const storageKey = `sb-${SUPABASE_URL.split('//')[1].split('.')[0]}-auth-token`
            localStorage.removeItem(storageKey)
            if (mounted) { setSession(null); setProfile(null); setLoading(false) }
            return
          }
        }

        setSession(sess)
        const ok = await loadProfile(sess)
        if (!ok && mounted) {
          // Retry once after a short delay
          await new Promise(r => setTimeout(r, 1500))
          if (mounted) await loadProfile(sess)
        }
      }

      if (mounted) {
        setLoading(false)
        initDone.current = true
      }
    }

    init()

    // Backup listener for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (!mounted) return
        setSession(newSession)
        if (event === 'TOKEN_REFRESHED') {
          // Hand the rotated JWT to the realtime socket so open channels don't
          // silently go stale (causes "message sent but doesn't appear" bug).
          if (newSession?.access_token) {
            try { supabase.realtime.setAuth(newSession.access_token) } catch { /* noop */ }
          }
          return
        }
        if (newSession) {
          await loadProfile(newSession)
        } else {
          loadedUserIdRef.current = null
          setProfile(null)
        }
        setLoading(false)
      }
    )

    // When the tab becomes visible again after sleep/inactivity, reassert auth
    // on the realtime socket. Supabase-js reconnects the transport on its own,
    // but the channel-level JWT may be stale if it was refreshed while hidden.
    //
    // Cache the last token we set so repeated visibility flips with an
    // unchanged JWT don't trigger redundant setAuth → channel reconnect →
    // SUBSCRIBED-status events that downstream hooks read as "we just
    // reconnected, refetch everything". This was the second-biggest source
    // of the "page refreshes when I switch back to it" perception.
    let lastSetToken = null
    function handleVisibility() {
      if (typeof window !== 'undefined' && window.__pe_debug) {
        console.log('[pe-debug] visibility', document.visibilityState, 'at', new Date().toISOString())
      }
      if (document.visibilityState !== 'visible') return
      supabase.auth.getSession().then(({ data }) => {
        const token = data?.session?.access_token
        if (token && token !== lastSetToken) {
          if (typeof window !== 'undefined' && window.__pe_debug) {
            console.log('[pe-debug] setAuth on visible (token changed)')
          }
          try { supabase.realtime.setAuth(token); lastSetToken = token } catch { /* noop */ }
        }
      })
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      mounted = false
      subscription.unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [loadProfile])

  const refreshProfile = useCallback(async () => {
    if (!session) return
    setLoading(true)
    // Bust the dedupe cache — caller explicitly wants a fresh fetch.
    loadedUserIdRef.current = null
    const ok = await loadProfile(session)
    if (!ok) {
      // Try refreshing the session first
      try {
        const { data } = await Promise.race([
          supabase.auth.refreshSession(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ])
        if (data?.session) {
          setSession(data.session)
          await loadProfile(data.session)
        }
      } catch {
        console.warn('Refresh timed out during retry')
      }
    }
    setLoading(false)
  }, [session, loadProfile])

  const isManagerForTeam = useCallback((teamId) => {
    if (profile?.role === 'Admin') return true
    return profile?.team_roles?.[teamId] === 'Manager'
  }, [profile])

  // Sync activeTeamId after profile loads — prefer stored valid team, else default.
  useEffect(() => {
    if (!profile?.id) return
    const stored = getStoredActiveTeamId(profile.id)
    const validStored = stored && (profile.team_ids || []).includes(stored) ? stored : null
    const next = validStored || pickDefaultTeam(profile)
    setActiveTeamIdState(next)
    if (next && next !== stored) setStoredActiveTeamId(profile.id, next)
  }, [profile])

  const setActiveTeamId = useCallback((teamId) => {
    setActiveTeamIdState(teamId)
    if (profile?.id) setStoredActiveTeamId(profile.id, teamId)
  }, [profile?.id])

  useDmRealtime(profile?.id)

  // Presence heartbeat — bumps profile_presence.last_seen_at so the
  // notification digest knows the user is "online". Fires immediately on
  // mount, then every 60s while the tab is visible. Pauses when hidden so
  // we don't burn DB updates on idle background tabs.
  //
  // Migration 084 split the heartbeat off `profiles` onto its own
  // `profile_presence` table written via the `heartbeat()` SECURITY DEFINER
  // RPC. This avoids re-firing the sync_effective_role + 042 self-update
  // guard triggers ~16x/sec at 1000 active users.
  useEffect(() => {
    if (!profile?.id) return
    let timer = null
    const bump = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        await supabase.rpc('heartbeat')
      } catch (e) {
        console.warn('heartbeat rpc failed:', e)
      }
    }
    bump()
    timer = setInterval(bump, 60000)
    const onVisibility = () => { if (document.visibilityState === 'visible') bump() }
    document.addEventListener('visibilitychange', onVisibility)

    // Best-effort final mark on tab close. `pagehide` fires reliably across
    // browsers (more than `beforeunload`/`unload`), and `sendBeacon` is the
    // only request type the browser guarantees to flush during teardown.
    //
    // Limitation: sendBeacon ships the request from the browser without any
    // headers we attach via fetch interceptors. To authenticate with
    // PostgREST we have to inline the user's JWT into the URL via the
    // `apikey` param plus a `Bearer` we can't actually set — meaning this
    // call lands as the anon role at PostgREST. That's why we no-op
    // gracefully if it fails: the worst case is the user simply doesn't get
    // a final bump, and the next time they open the app the regular
    // interval picks up. The 5-min digest "offline" window already tolerates
    // a missing final tick.
    const onPageHide = () => {
      try {
        if (!navigator.sendBeacon) return
        const url = `${SUPABASE_URL}/rest/v1/rpc/heartbeat?apikey=${encodeURIComponent(SUPABASE_KEY)}`
        navigator.sendBeacon(url, new Blob(['{}'], { type: 'application/json' }))
      } catch {
        // Swallow — best-effort only.
      }
    }
    window.addEventListener('pagehide', onPageHide)

    return () => {
      if (timer) clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [profile?.id])

  // Memoize the context value so consumers don't see a fresh reference on
  // every AuthProvider render. Without this, anything React does that
  // re-renders AuthProvider (parent re-render, an unrelated state hook
  // tick) would propagate as a new context object to every useAuth()
  // consumer in the tree — basically every page and panel.
  const value = useMemo(() => ({
    session,
    profile,
    loading,
    refreshProfile,
    isAdmin:    profile?.role === 'Admin',
    isManager:  profile?.role === 'Manager' || profile?.role === 'Admin',
    isStaff:    profile?.role === 'Staff',
    isAgent:    isAgent(profile),
    isClient:   isClient(profile),
    isExternal: isExternal(profile),
    isManagerForTeam,
    activeTeamId,
    setActiveTeamId,
  }), [
    session, profile, loading, refreshProfile,
    isManagerForTeam, activeTeamId,
  ])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
