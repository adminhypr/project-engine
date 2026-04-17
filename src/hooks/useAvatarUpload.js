import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB

function sanitizeName(name) {
  return (name || 'avatar').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)
}

export function useAvatarUpload() {
  const { profile, session, refreshProfile } = useAuth()
  const [uploading, setUploading] = useState(false)

  const uploadAvatar = useCallback(async (file) => {
    if (!profile?.id) return false
    if (!file || !file.type?.startsWith('image/')) {
      showToast('Pick an image file (JPEG, PNG, WebP, or GIF)', 'error')
      return false
    }
    if (file.size > MAX_BYTES) {
      showToast('Image exceeds 5 MB limit', 'error')
      return false
    }

    setUploading(true)
    const userId = profile.id
    const path = `${userId}/${Date.now()}-${sanitizeName(file.name)}`

    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { contentType: file.type, upsert: false })
    if (uploadErr) {
      setUploading(false)
      showToast('Upload failed', 'error')
      return false
    }

    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
    const publicUrl = pub?.publicUrl || null

    const { error: dbErr } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', userId)
    if (dbErr) {
      await supabase.storage.from('avatars').remove([path]).catch(() => {})
      setUploading(false)
      showToast('Failed to update profile', 'error')
      return false
    }

    // Best-effort: delete any older files in the user's folder.
    try {
      const { data: files } = await supabase.storage.from('avatars').list(userId, { limit: 100 })
      const keepName = path.split('/').pop()
      const toRemove = (files || [])
        .filter(f => f.name !== keepName)
        .map(f => `${userId}/${f.name}`)
      if (toRemove.length > 0) {
        await supabase.storage.from('avatars').remove(toRemove)
      }
    } catch { /* non-critical */ }

    try {
      await refreshProfile()
    } finally {
      setUploading(false)
    }
    showToast('Avatar updated')
    return true
  }, [profile?.id, refreshProfile])

  const removeAvatar = useCallback(async () => {
    if (!profile?.id) return false
    const googleUrl = session?.user?.user_metadata?.avatar_url || null

    setUploading(true)
    const { error: dbErr } = await supabase
      .from('profiles')
      .update({ avatar_url: googleUrl })
      .eq('id', profile.id)
    if (dbErr) {
      setUploading(false)
      showToast('Failed to reset avatar', 'error')
      return false
    }

    try {
      const { data: files } = await supabase.storage.from('avatars').list(profile.id, { limit: 100 })
      const toRemove = (files || []).map(f => `${profile.id}/${f.name}`)
      if (toRemove.length > 0) await supabase.storage.from('avatars').remove(toRemove)
    } catch { /* non-critical */ }

    try {
      await refreshProfile()
    } finally {
      setUploading(false)
    }
    showToast(googleUrl ? 'Reverted to default avatar' : 'Avatar cleared')
    return true
  }, [profile?.id, session?.user?.user_metadata?.avatar_url, refreshProfile])

  return { uploadAvatar, removeAvatar, uploading }
}
