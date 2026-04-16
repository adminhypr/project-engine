import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const BUCKET = 'hub-todo-attachments'

export function useHubTodoAttachments(hubId) {
  const { profile } = useAuth()
  const [uploading, setUploading] = useState([])

  const uploadFile = useCallback(async (file) => {
    if (!hubId || !profile?.id) return null
    if (file.size > MAX_FILE_SIZE) {
      showToast(`${file.name} exceeds 10 MB limit`, 'error')
      return null
    }

    const tempId = crypto.randomUUID()
    setUploading(prev => [...prev, { id: tempId, name: file.name }])

    const uid = crypto.randomUUID()
    const safeName = file.name.replace(/[/\\\x00-\x1f]/g, '_')
    const storagePath = `${hubId}/${uid}_${safeName}`

    const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file)
    setUploading(prev => prev.filter(u => u.id !== tempId))

    if (error) { showToast(`Upload failed: ${file.name}`, 'error'); return null }

    return {
      path: storagePath,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
    }
  }, [hubId, profile?.id])

  const signedUrl = useCallback(async (path) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    return data?.signedUrl || null
  }, [])

  const removeFile = useCallback(async (path) => {
    const { error } = await supabase.storage.from(BUCKET).remove([path])
    if (error) { showToast('Failed to remove file', 'error'); return false }
    return true
  }, [])

  return { uploadFile, signedUrl, removeFile, uploading }
}
