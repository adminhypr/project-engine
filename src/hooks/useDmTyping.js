import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Broadcast-only typing presence for DMs and group conversations. Nothing
// hits the DB — pure Supabase realtime broadcast.
//
//   emitTyping()    — call on every keystroke; throttled internally
//   typingUserIds   — array of user ids currently typing, excluding self
//   otherTyping     — convenience boolean (typingUserIds.length > 0) so
//                     existing DM callsites can stay as-is
//
// Protocol:
//   broadcast event "typing" payload { userId, typing: boolean }
//   - "typing:true" repeats every 2s while typing continues
//   - "typing:false" is sent on pause (3s idle) or on unmount
// Each user id carries its own expiry; an interval sweep clears entries
// older than STALE_MS (covers client drops / tab closes without clean
// "typing:false").

const REPEAT_MS = 2000
const IDLE_MS   = 3000
const STALE_MS  = 4000
const SWEEP_MS  = 500

export function useDmTyping(conversationId, myId) {
  // Map<userId, expireAt> stored in a ref so the broadcast handler can
  // mutate without forcing a re-render on every echo. We only setState
  // when the set of keys changes (user started/stopped typing).
  const typingMapRef = useRef(new Map())
  const [typingUserIds, setTypingUserIds] = useState([])

  const channelRef = useRef(null)
  const lastSentRef = useRef(0)
  const idleTimerRef = useRef(null)

  function publishIds() {
    const ids = [...typingMapRef.current.keys()]
    // Cheap reference-stable comparison to avoid needless re-renders.
    setTypingUserIds(prev =>
      prev.length === ids.length && prev.every((id, i) => id === ids[i])
        ? prev
        : ids
    )
  }

  useEffect(() => {
    if (!conversationId || !myId) return
    typingMapRef.current = new Map()
    setTypingUserIds([])

    const channel = supabase.channel(`pe-dm-typing-${conversationId}`, {
      config: { broadcast: { self: false } },
    })
    channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!payload || payload.userId === myId) return
      if (payload.typing) {
        typingMapRef.current.set(payload.userId, Date.now() + STALE_MS)
      } else {
        typingMapRef.current.delete(payload.userId)
      }
      publishIds()
    })
    channel.subscribe()
    channelRef.current = channel

    // Sweep expired entries — cheap, one interval for the whole channel.
    const sweep = setInterval(() => {
      const now = Date.now()
      let changed = false
      for (const [id, exp] of typingMapRef.current) {
        if (exp <= now) { typingMapRef.current.delete(id); changed = true }
      }
      if (changed) publishIds()
    }, SWEEP_MS)

    return () => {
      // Best-effort "stopped typing" on unmount so the other side clears fast.
      try { channel.send({ type: 'broadcast', event: 'typing', payload: { userId: myId, typing: false } }) } catch { /* noop */ }
      supabase.removeChannel(channel)
      channelRef.current = null
      clearInterval(sweep)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      typingMapRef.current = new Map()
      setTypingUserIds([])
    }
  }, [conversationId, myId])

  const sendTyping = useCallback((typing) => {
    const ch = channelRef.current
    if (!ch || !myId) return
    try {
      ch.send({ type: 'broadcast', event: 'typing', payload: { userId: myId, typing } })
    } catch { /* noop */ }
  }, [myId])

  const emitTyping = useCallback(() => {
    const now = Date.now()
    if (now - lastSentRef.current > REPEAT_MS) {
      lastSentRef.current = now
      sendTyping(true)
    }
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      lastSentRef.current = 0
      sendTyping(false)
    }, IDLE_MS)
  }, [sendTyping])

  return {
    typingUserIds,
    otherTyping: typingUserIds.length > 0,
    emitTyping,
  }
}
