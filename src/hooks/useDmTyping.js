import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Broadcast-only typing presence per DM conversation. Nothing hits the DB.
//   emitTyping()   — call on every keystroke; throttled internally
//   otherTyping    — boolean reflecting the OTHER participant's typing state
//
// Protocol:
//   broadcast event "typing" payload { userId, typing: boolean }
//   - "typing:true" repeats every 2s while typing continues
//   - "typing:false" is sent on pause (3s idle) or on unmount
// Receiver auto-clears the indicator if no refresh for 4s (covers client drops).

const REPEAT_MS = 2000
const IDLE_MS   = 3000
const STALE_MS  = 4000

export function useDmTyping(conversationId, myId) {
  const [otherTyping, setOtherTyping] = useState(false)
  const channelRef = useRef(null)
  const lastSentRef = useRef(0)
  const idleTimerRef = useRef(null)
  const staleTimerRef = useRef(null)

  useEffect(() => {
    if (!conversationId || !myId) return
    const channel = supabase.channel(`pe-dm-typing-${conversationId}`, {
      config: { broadcast: { self: false } },
    })
    channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!payload || payload.userId === myId) return
      if (payload.typing) {
        setOtherTyping(true)
        if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
        staleTimerRef.current = setTimeout(() => setOtherTyping(false), STALE_MS)
      } else {
        setOtherTyping(false)
        if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
      }
    })
    channel.subscribe()
    channelRef.current = channel
    return () => {
      // Best-effort "stopped typing" on unmount so the other side clears fast.
      try { channel.send({ type: 'broadcast', event: 'typing', payload: { userId: myId, typing: false } }) } catch { /* noop */ }
      supabase.removeChannel(channel)
      channelRef.current = null
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
      setOtherTyping(false)
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

  return { otherTyping, emitTyping }
}
