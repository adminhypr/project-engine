import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui'
import { isBlockedImageType } from '../lib/uploadGuards'
import { parseWallpaper, resolveWallpaperBackground } from '../lib/chatWallpaper'

// Per-conversation SHARED wallpaper (migration 107). Whoever sets it changes
// it for EVERYONE in the conversation. The value lives on conversations.wallpaper
// and is one of:
//   'preset:<key>'  → a neon gradient (resolved purely)
//   'upload:<path>' → a dm-attachments object, signed for display
//   null            → no wallpaper
//
// This hook:
//   • fetches the wallpaper for the SINGLE active conversation on its own
//     (a targeted select on conversations.wallpaper), so the main
//     `useConversations` list query does NOT have to reference the migration-107
//     columns. If the column doesn't exist yet (migration 107 un-applied), the
//     fetch degrades gracefully to "no wallpaper" instead of throwing — the
//     chat UI works normally, just without wallpaper, until the migration lands.
//   • subscribes to conversations UPDATE for this id so all participants see
//     changes live,
//   • signs the storage path when the value is an upload,
//   • exposes setPreset / uploadImage / removeWallpaper writers (each writes
//     wallpaper + wallpaper_set_by + wallpaper_set_at on the conversations row).

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB cap for wallpaper uploads

// When migration 107 hasn't been applied, the wallpaper columns don't exist.
// PostgREST surfaces this differently for reads vs writes:
//   - SELECT  → 400 with Postgres code '42703' ("column ... does not exist")
//   - UPDATE  → 'PGRST204' ("Could not find the 'wallpaper' column of
//               'conversations' in the schema cache")
// We treat all of these as "feature not enabled yet" and degrade gracefully
// instead of surfacing a generic failure.
function isUndefinedColumnError(error) {
  if (!error) return false
  const msg = error.message || ''
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /column .*wallpaper.* does not exist/i.test(msg) ||
    /could not find the .*wallpaper.* column/i.test(msg) ||
    (/wallpaper/i.test(msg) && /schema cache/i.test(msg))
  )
}

export function useConversationWallpaper(conversationId) {
  const { profile } = useAuth()
  const [wallpaper, setWallpaper] = useState(null)
  const [signedUrl, setSignedUrl] = useState(null)
  const [busy, setBusy] = useState(false)

  const cidRef = useRef(conversationId)
  cidRef.current = conversationId

  // Reset local state when switching conversations, then fetch the wallpaper for
  // the new conversation on its own. Degrades to no-wallpaper if the column
  // doesn't exist yet (migration 107 un-applied) — never throws into the UI.
  useEffect(() => {
    setWallpaper(null)
    setSignedUrl(null)
    if (!conversationId) return
    let alive = true
    supabase
      .from('conversations')
      .select('wallpaper, wallpaper_set_by, wallpaper_set_at')
      .eq('id', conversationId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return
        if (error) {
          // Undefined-column (migration not applied) or any fetch error →
          // silently treat as no wallpaper. The list + chat keep working.
          if (!isUndefinedColumnError(error)) {
            // Non-schema errors are non-fatal here too; log for visibility only.
            console.warn('[wallpaper] fetch failed', error)
          }
          return
        }
        setWallpaper(data?.wallpaper ?? null)
      })
    return () => { alive = false }
  }, [conversationId])

  // Realtime: any participant changing the wallpaper updates everyone live.
  useEffect(() => {
    if (!conversationId) return
    const channel = supabase
      .channel(`pe-conv-wallpaper-${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversations',
          filter: `id=eq.${conversationId}`,
        },
        (payload) => {
          const next = payload.new
          if (!next) return
          setWallpaper(prev => (prev === next.wallpaper ? prev : next.wallpaper ?? null))
        }
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [conversationId])

  // Sign the storage path whenever the value is an upload. Presets / null clear it.
  useEffect(() => {
    const parsed = parseWallpaper(wallpaper)
    if (!parsed || parsed.type !== 'upload') {
      setSignedUrl(null)
      return
    }
    let alive = true
    supabase.storage
      .from('dm-attachments')
      .createSignedUrl(parsed.value, 3600)
      .then(({ data }) => {
        if (alive) setSignedUrl(data?.signedUrl || null)
      })
    return () => { alive = false }
  }, [wallpaper])

  const writeWallpaper = useCallback(async (value) => {
    const cid = cidRef.current
    if (!cid) return false
    const { error } = await supabase
      .from('conversations')
      .update({
        wallpaper: value,
        wallpaper_set_by: profile?.id || null,
        wallpaper_set_at: new Date().toISOString(),
      })
      .eq('id', cid)
    if (error) {
      if (isUndefinedColumnError(error)) {
        showToast('Wallpapers aren’t enabled yet', 'error')
      } else {
        showToast('Could not update the wallpaper', 'error')
      }
      return false
    }
    // Optimistic — realtime echo from our own write is dedup'd by value.
    setWallpaper(value)
    return true
  }, [profile?.id])

  const setPreset = useCallback(async (key) => {
    if (!key || busy) return false
    setBusy(true)
    try {
      return await writeWallpaper(`preset:${key}`)
    } finally {
      setBusy(false)
    }
  }, [busy, writeWallpaper])

  const removeWallpaper = useCallback(async () => {
    if (busy) return false
    setBusy(true)
    try {
      return await writeWallpaper(null)
    } finally {
      setBusy(false)
    }
  }, [busy, writeWallpaper])

  const uploadImage = useCallback(async (file) => {
    const cid = cidRef.current
    if (!file || !cid || busy) return false
    if (isBlockedImageType(file)) {
      showToast('SVG images aren’t allowed', 'error')
      return false
    }
    if (!String(file.type || '').startsWith('image/')) {
      showToast('Please choose an image file', 'error')
      return false
    }
    if (file.size > MAX_BYTES) {
      showToast('Image must be 5 MB or smaller', 'error')
      return false
    }
    setBusy(true)
    try {
      const dot = file.name?.lastIndexOf('.') ?? -1
      const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : 'jpg'
      // dm-attachments RLS keys on the FIRST folder segment = conversation id.
      const path = `${cid}/wallpaper/${crypto.randomUUID()}.${ext || 'jpg'}`
      const { error: upErr } = await supabase.storage
        .from('dm-attachments')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (upErr) {
        showToast('Upload failed', 'error')
        return false
      }
      return await writeWallpaper(`upload:${path}`)
    } finally {
      setBusy(false)
    }
  }, [busy, writeWallpaper])

  const resolvedBackground = resolveWallpaperBackground(wallpaper, signedUrl)

  return { wallpaper, resolvedBackground, setPreset, uploadImage, removeWallpaper, busy }
}
