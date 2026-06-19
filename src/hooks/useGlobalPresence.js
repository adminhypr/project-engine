import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getStatus, effectiveStatus, subscribe as subscribeStatus } from '../lib/presenceStatus'

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
//
// Manual status (Slack-style "Set yourself active/away/appear offline") is a
// frontend-only override persisted in localStorage (see lib/presenceStatus).
// We broadcast an EFFECTIVE status field in the track() payload:
//   · override 'active'  → always 'active' (even when idle)
//   · override 'away'    → always 'away'
//   · override 'offline' → 'offline' (appear offline though still connected)
//   · override 'auto'    → the automatic signal ('active' visible+active,
//                          'away' idle, 'offline' hidden)
// Other subscribers receive the status the moment we re-track(), so a manual
// change propagates live with no DB / heartbeat involvement.

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
    let idle = false          // automatic-idle flag (idle timer fired)
    let lastStatus = null     // last EFFECTIVE status we broadcast (dedupe)

    // The AUTOMATIC status, ignoring any manual override: 'active' when the
    // tab is visible and the user is active, 'away' when visible but idle,
    // 'offline' when the tab is hidden.
    function autoStatus() {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 'offline'
      return idle ? 'away' : 'active'
    }

    // The status we actually broadcast: manual override layered over auto.
    function computeStatus() {
      return effectiveStatus(getStatus(profile.id), autoStatus())
    }

    // Push the current effective status onto the presence channel. We always
    // stay TRACKED (so others can see an explicit 'away'/'offline' state),
    // except when the user closes the tab. Re-tracking with the same status
    // is skipped to avoid churning every subscriber's presenceState sync.
    async function pushStatus() {
      if (!subscribed) return
      const status = computeStatus()
      if (tracked && status === lastStatus) return
      lastStatus = status
      tracked = true
      try {
        await channel.track({
          user_id: profile.id,
          online_at: new Date().toISOString(),
          status,
        })
      } catch { /* will retry on next signal / re-subscribe */ }
    }

    async function untrackNow() {
      if (!tracked) return
      tracked = false
      lastStatus = null
      try { await channel.untrack() } catch { /* noop */ }
    }

    function resetIdleTimer() {
      // Any activity clears the idle flag and re-arms the timer.
      if (idle) { idle = false }
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => { idle = true; pushStatus() }, IDLE_MS)
      pushStatus()
    }

    function handleVisibility() {
      if (document.visibilityState === 'hidden') {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null }
        // Re-broadcast: auto path → offline; a manual active/away/offline
        // override is preserved by computeStatus().
        pushStatus()
      } else {
        idle = false
        resetIdleTimer()
      }
    }

    // Re-broadcast immediately when the user changes their manual status so
    // other users see it live (this is the propagation mechanism).
    const unsubStatus = subscribeStatus(({ profileId: changed }) => {
      if (!changed || changed === profile.id) pushStatus()
    })

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
          // Pick the freshest meta for a display timestamp + status. Presence
          // from *any* tab of this user is enough; if multiple tabs disagree
          // on status the freshest meta wins (matches the online_at choice).
          const latest = metas[metas.length - 1]
          // status defaults to 'active' for older clients that tracked before
          // the status field existed (they were only tracked while online).
          const status = latest?.status || 'active'
          next.set(userId, {
            online: status === 'active',
            onlineAt: latest?.online_at,
            status,
          })
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
            if (!p || p.onlineAt !== v.onlineAt || p.status !== v.status) {
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
          lastStatus = null
          // Always announce our status on (re)subscribe. When visible we arm
          // the idle timer and broadcast active/away/offline per the override;
          // when hidden the auto path broadcasts 'offline' (a manual override
          // still wins). This means an "appear active" / "away" override is
          // visible to others even while the tab is backgrounded.
          if (document.visibilityState === 'visible') {
            idle = false
            resetIdleTimer()
          } else {
            await pushStatus()
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          subscribed = false
          tracked = false
          lastStatus = null
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
      unsubStatus()
      untrackNow().finally(() => {
        try { supabase.removeChannel(channel) } catch { /* noop */ }
      })
    }
    // Deliberately depends on profile?.id ONLY. Display name / avatar
    // changes shouldn't churn the presence channel.
  }, [profile?.id])

  return presence
}
