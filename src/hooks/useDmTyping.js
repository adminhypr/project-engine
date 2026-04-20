import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Broadcast-only typing presence for DMs and group conversations. Nothing
// hits the DB — pure Supabase realtime broadcast.
//
//   emitTyping()    — call on every keystroke; throttled internally
//   typingUserIds   — array of user ids currently typing, excluding self
//   otherTyping     — convenience boolean (typingUserIds.length > 0)
//
// Protocol:
//   broadcast event "typing" payload { userId, typing: boolean }
//   - "typing:true" repeats every 2s while typing continues
//   - "typing:false" is sent on pause (3s idle) or on unmount
// Each user id carries its own expiry; a 500ms sweep clears entries older
// than STALE_MS (covers clients that drop without a clean "typing:false").

const REPEAT_MS = 2000
const IDLE_MS   = 3000
const STALE_MS  = 4000
const SWEEP_MS  = 500

export function useDmTyping(conversationId, myId) {
  const typingMapRef = useRef(new Map()) // userId → expireAt
  const [typingUserIds, setTypingUserIds] = useState([])

  const channelRef = useRef(null)
  const readyRef = useRef(false)
  // If a typing event is requested before subscribe() resolves, stash the
  // latest desired state and flush it on SUBSCRIBED. This matters for the
  // very first keystroke after opening a pane — without it, the first 1-2
  // seconds of typing never reach the other side.
  const pendingTypingRef = useRef(null)
  const lastSentRef = useRef(0)
  const idleTimerRef = useRef(null)

  function publishIds() {
    const ids = [...typingMapRef.current.keys()]
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
    readyRef.current = false
    pendingTypingRef.current = null

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
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        readyRef.current = true
        // Flush any pending "typing:true" that was requested pre-subscribe.
        if (pendingTypingRef.current !== null) {
          try {
            channel.send({
              type: 'broadcast',
              event: 'typing',
              payload: { userId: myId, typing: pendingTypingRef.current },
            })
          } catch { /* noop */ }
          pendingTypingRef.current = null
        }
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        readyRef.current = false
      }
    })
    channelRef.current = channel

    const sweep = setInterval(() => {
      const now = Date.now()
      let changed = false
      for (const [id, exp] of typingMapRef.current) {
        if (exp <= now) { typingMapRef.current.delete(id); changed = true }
      }
      if (changed) publishIds()
    }, SWEEP_MS)

    return () => {
      try {
        if (readyRef.current) {
          channel.send({ type: 'broadcast', event: 'typing', payload: { userId: myId, typing: false } })
        }
      } catch { /* noop */ }
      supabase.removeChannel(channel)
      channelRef.current = null
      readyRef.current = false
      pendingTypingRef.current = null
      clearInterval(sweep)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      typingMapRef.current = new Map()
      setTypingUserIds([])
    }
  }, [conversationId, myId])

  const sendTyping = useCallback((typing) => {
    if (!myId) return
    if (!readyRef.current) {
      pendingTypingRef.current = typing
      return
    }
    const ch = channelRef.current
    if (!ch) return
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
