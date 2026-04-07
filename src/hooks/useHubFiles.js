import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { showToast } from '../components/ui/index'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

export function useHubFiles(hubId, folderId = null) {
  const { profile } = useAuth()
  const [files, setFiles]       = useState([])
  const [folders, setFolders]   = useState([])
  const [loading, setLoading]   = useState(true)
  const hubRef = useRef(hubId)
  hubRef.current = hubId

  const fetchContents = useCallback(async () => {
    if (!hubRef.current) return
    let folderQuery = supabase
      .from('hub_folders')
      .select('*, creator:profiles(id, full_name)')
      .eq('hub_id', hubRef.current)
      .order('name')
    if (folderId) folderQuery = folderQuery.eq('parent_id', folderId)
    else folderQuery = folderQuery.is('parent_id', null)

    let fileQuery = supabase
      .from('hub_files')
      .select('*, uploader:profiles(id, full_name, avatar_url)')
      .eq('hub_id', hubRef.current)
      .order('created_at', { ascending: false })
    if (folderId) fileQuery = fileQuery.eq('folder_id', folderId)
    else fileQuery = fileQuery.is('folder_id', null)

    const [{ data: folderData, error: fErr }, { data: fileData, error: fiErr }] = await Promise.all([
      folderQuery, fileQuery
    ])
    if (fErr || fiErr) showToast('Failed to load files', 'error')
    setFolders(folderData || [])
    setFiles(fileData || [])
    setLoading(false)
  }, [folderId])

  useEffect(() => {
    if (!hubId) return
    setLoading(true)
    fetchContents()
  }, [hubId, folderId, fetchContents])

  const uploadFiles = useCallback(async (fileList) => {
    if (!hubRef.current || !profile?.id) return { ok: false, errors: ['Not authenticated'] }
    const errors = []
    const results = []

    for (const file of fileList) {
      if (file.size > MAX_FILE_SIZE) {
        errors.push(`${file.name} exceeds 10 MB limit`)
        continue
      }
      const uid = crypto.randomUUID()
      const storagePath = `${hubRef.current}/${folderId || 'root'}/${uid}_${file.name}`

      const { error: uploadErr } = await supabase.storage.from('hub-files').upload(storagePath, file)
      if (uploadErr) { errors.push(`${file.name}: upload failed`); continue }

      const { data, error: dbErr } = await supabase.from('hub_files').insert({
        hub_id: hubRef.current,
        folder_id: folderId || null,
        uploaded_by: profile.id,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
        storage_path: storagePath
      }).select().single()

      if (dbErr) {
        await supabase.storage.from('hub-files').remove([storagePath])
        errors.push(`${file.name}: save failed`)
      } else {
        results.push(data)
      }
    }

    if (errors.length > 0) showToast(errors[0], 'error')
    else if (results.length > 0) showToast(`${results.length} file${results.length > 1 ? 's' : ''} uploaded`)
    await fetchContents()
    return { ok: errors.length === 0, results, errors }
  }, [profile?.id, folderId, fetchContents])

  const createFolder = useCallback(async (name, color) => {
    if (!hubRef.current || !profile?.id) return false
    const { error } = await supabase.from('hub_folders').insert({
      hub_id: hubRef.current,
      parent_id: folderId || null,
      name: name.trim(),
      color: color || null,
      created_by: profile.id
    })
    if (error) { showToast('Failed to create folder', 'error'); return false }
    await fetchContents()
    return true
  }, [profile?.id, folderId, fetchContents])

  const deleteFile = useCallback(async (fileId, storagePath) => {
    await supabase.storage.from('hub-files').remove([storagePath])
    const { error } = await supabase.from('hub_files').delete().eq('id', fileId)
    if (error) showToast('Failed to delete file', 'error')
    await fetchContents()
  }, [fetchContents])

  const deleteFolder = useCallback(async (fdrId) => {
    const { error } = await supabase.from('hub_folders').delete().eq('id', fdrId)
    if (error) showToast('Failed to delete folder', 'error')
    await fetchContents()
  }, [fetchContents])

  const getFileUrl = useCallback(async (storagePath) => {
    const { data, error } = await supabase.storage.from('hub-files').createSignedUrl(storagePath, 3600)
    if (error) { showToast('Failed to get file URL', 'error'); return null }
    return data.signedUrl
  }, [])

  return { files, folders, loading, uploadFiles, createFolder, deleteFile, deleteFolder, getFileUrl, refetch: fetchContents }
}
