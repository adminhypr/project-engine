import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Global presence channel mounted once in AuthProvider. Other users see
// you online while:
//   · the tab is visible, AND
//   · you've been active (mouse / keyboard / scroll / touch) within the
//     last IDLE_MS window.
//
// Going offline happens immediately when the tab is hidden, when the user
// closes the window (beforeunload / pagehide), or when the idle timer
// fires. This matches Slack / Messenger convention and is much more
// accurate than "user has the tab open → user is online", which kept the
// green dot lit for people who'd been AFK for hours.

const CHANNEL = 'pe-global-presence'
const IDLE_MS = 5 * 60 * 1000    // 5 minutes of no activity → offline

export function useGlobalPresence(profile) {
  const [presence, setPresence] = useState(() => new Map())

  useEffect(() => {
    if (!profile?.id) return
    const channel = supabase.channel(CHANNEL, {
      config: { presence: { key: profile.id } },
    })

    // Single source of truth for "am I currently tracked?" to keep
    // track/untrack idempotent across reconnects and rapid visibility
    // toggles (alt-tab spam, OS sleep cycles, etc.).
    let tracked = false
    let idleTimer = null
    let subscribed = false

    async function goOnline() {
      if (tracked || !subscribed) return
      tracked = true
      try {
        await channel.track({
          user_id: profile.id,
          online_at: new Date().toISOString(),
        })
      } catch { tracked = false }
    }

    async function goOffline() {
      if (!tracked) return
      tracked = false
      try { await channel.untrack() } catch { /* noop */ }
    }

    function resetIdleTimer() {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => { goOffline() }, IDLE_MS)
      if (document.visibilityState === 'visible') goOnline()
    }

    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        goOffline()
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
      } else {
        resetIdleTimer()
      }
    }

    function handleUnload() {
      // Fire-and-forget: browsers give us a short beat to push the untrack
      // before the page closes. sendBeacon would be more reliable, but
      // Supabase presence doesn't expose a raw endpoint — best effort.
      try { channel.untrack() } catch { /* noop */ }
    }

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const next = new Map()
        for (const [userId, metas] of Object.entries(state)) {
          if (!metas || metas.length === 0) continue
          // Skip OURSELVES. The current user is obviously online whenever
          // they're using the app — no consumer cares about their own dot.
          // Including the self-entry meant every browser-tab hide/show
          // toggled our own track() state, which changed the Map, which
          // changed the AuthContext value, which re-rendered every page
          // and panel that calls useAuth(). That's the "task page
          // refreshes when I switch back to the tab" report.
          if (userId === profile.id) continue
          // Pick the freshest meta for a display timestamp; presence from
          // *any* active tab of this user is enough to show them online.
          const latest = metas[metas.length - 1]
          next.set(userId, { online: true, onlineAt: latest?.online_at })
        }
        // Supabase emits a `sync` event roughly every 10s even when no
        // user actually came/went online. If we unconditionally call
        // setPresence with a fresh Map, the new reference cascades
        // through useAuth().presence and re-renders every consumer
        // (NotificationBell, ChatWidget, ContactList, page layouts). Skip
        // the update when the membership and timestamps are identical
        // to what we already have — that's the single biggest source of
        // the "page refreshes every ~10 seconds" perception.
        setPresence(prev => {
          if (prev.size !== next.size) {
            if (typeof window !== 'undefined' && window.__pe_debug) {
              console.log('[pe-debug] presence sync DIFFERENT (size changed)', { prev: prev.size, next: next.size })
            }
            return next
          }
          for (const [k, v] of next) {
            const p = prev.get(k)
            if (!p || p.onlineAt !== v.onlineAt) {
              if (typeof window !== 'undefined' && window.__pe_debug) {
                console.log('[pe-debug] presence sync DIFFERENT (entry changed)', k)
              }
              return next
            }
          }
          if (typeof window !== 'undefined' && window.__pe_debug) {
            // Don't spam — but we want to know when sync fires with no changes.
            console.log('[pe-debug] presence sync UNCHANGED (skipped)')
          }
          return prev
        })
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          subscribed = true
          // Only announce online if the tab is currently visible. If the
          // pane was opened while hidden, we'll catch up on visibilitychange.
          if (document.visibilityState === 'visible') {
            await goOnline()
            resetIdleTimer()
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          subscribed = false
          tracked = false
        }
      })

    // Activity signals — treat them as evidence the user is actually here.
    const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, resetIdleTimer, { passive: true })
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('beforeunload', handleUnload)
    window.addEventListener('pagehide', handleUnload)

    return () => {
      if (idleTimer) clearTimeout(idleTimer)
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, resetIdleTimer)
      }
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('beforeunload', handleUnload)
      window.removeEventListener('pagehide', handleUnload)
      goOffline().finally(() => {
        try { supabase.removeChannel(channel) } catch { /* noop */ }
      })
    }
    // Deliberately depends on profile?.id ONLY. Display name / avatar
    // changes shouldn't churn the presence channel.
  }, [profile?.id])

  return presence
}
