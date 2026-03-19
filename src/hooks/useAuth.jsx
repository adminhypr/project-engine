import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// Direct REST call — bypasses the Supabase JS client's auth queue
async function fetchProfileDirect(userId, accessToken) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=*,teams(id,name)`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Accept-Profile': 'public',
        },
        signal: controller.signal,
      }
    )
    clearTimeout(timeout)

    if (!res.ok) {
      console.error('Profile fetch HTTP error:', res.status)
      return null
    }

    const rows = await res.json()
    return rows?.[0] || null
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
  const initDone = useRef(false)

  const loadProfile = useCallback(async (sess) => {
    if (!sess?.access_token || !sess?.user?.id) return false
    const data = await fetchProfileDirect(sess.user.id, sess.access_token)
    if (data) {
      setProfile(data)
      return true
    }
    return false
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
              if (mounted) { setSession(null); setProfile(null); setLoading(false) }
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
      async (_event, newSession) => {
        if (!mounted) return
        setSession(newSession)
        if (newSession) {
          await loadProfile(newSession)
        } else {
          setProfile(null)
        }
        setLoading(false)
      }
    )

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [loadProfile])

  const refreshProfile = useCallback(async () => {
    if (!session) return
    setLoading(true)
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

  const value = {
    session,
    profile,
    loading,
    refreshProfile,
    isAdmin:   profile?.role === 'Admin',
    isManager: profile?.role === 'Manager' || profile?.role === 'Admin',
    isStaff:   profile?.role === 'Staff'
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
