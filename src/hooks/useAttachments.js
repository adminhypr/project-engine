import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const BUCKET = 'task-attachments'

export function validateFiles(fileList) {
  const valid = []
  const oversized = []
  for (const file of fileList) {
    if (file.size > MAX_FILE_SIZE) {
      oversized.push(file)
    } else {
      valid.push(file)
    }
  }
  return { valid, oversized }
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function useAttachments() {
  const { profile } = useAuth()

  async function uploadAttachments(taskId, files, commentId = null) {
    const results = []
    const errors = []

    for (const file of files) {
      const uid = crypto.randomUUID()
      const storagePath = `${profile.id}/${taskId}/${uid}_${file.name}`

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, file)

      if (uploadError) {
        errors.push({ file: file.name, error: uploadError.message })
        continue
      }

      const { data, error: insertError } = await supabase
        .from('task_attachments')
        .insert({
          task_id: taskId,
          comment_id: commentId,
          uploaded_by: profile.id,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type || 'application/octet-stream',
          storage_path: storagePath
        })
        .select('*')
        .single()

      if (insertError) {
        errors.push({ file: file.name, error: insertError.message })
        // Clean up the uploaded file since the DB row failed
        await supabase.storage.from(BUCKET).remove([storagePath])
      } else {
        results.push(data)
      }
    }

    return { ok: errors.length === 0, attachments: results, errors }
  }

  // Carry attachments from a promoted Feature Request / Bug onto the new task.
  // Bug/request files live in the `project-attachments` bucket with metadata in
  // a jsonb column ({ storage_path, file_name, mime_type, size }); task files
  // live in `task-attachments` + the task_attachments table. The two are
  // separate, so we download each source object and re-upload it through the
  // normal task path (new bucket object + task_attachments row).
  async function copyProjectAttachmentsToTask(taskId, sourceAttachments = [], sourceBucket = 'project-attachments') {
    const files = []
    const errors = []
    for (const a of sourceAttachments) {
      if (!a?.storage_path) continue
      const { data: blob, error } = await supabase.storage.from(sourceBucket).download(a.storage_path)
      if (error || !blob) { errors.push({ file: a.file_name, error: error?.message || 'download failed' }); continue }
      files.push(new File([blob], a.file_name || 'file', { type: a.mime_type || blob.type || 'application/octet-stream' }))
    }
    if (!files.length) return { ok: errors.length === 0, attachments: [], errors }
    const up = await uploadAttachments(taskId, files)
    return { ok: up.ok && errors.length === 0, attachments: up.attachments, errors: [...errors, ...up.errors] }
  }

  async function getTaskAttachments(taskId) {
    const { data, error } = await supabase
      .from('task_attachments')
      .select('*, uploader:profiles!task_attachments_uploaded_by_fkey(full_name)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true })

    if (error) return { ok: false, attachments: [], error: error.message }
    return { ok: true, attachments: data }
  }

  async function getAttachmentUrl(storagePath) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 3600)

    if (error) return { ok: false, url: null, error: error.message }
    return { ok: true, url: data.signedUrl }
  }

  async function deleteAttachment(attachmentId, storagePath) {
    const { error: storageError } = await supabase.storage
      .from(BUCKET)
      .remove([storagePath])

    if (storageError) return { ok: false, error: storageError.message }

    const { error: dbError } = await supabase
      .from('task_attachments')
      .delete()
      .eq('id', attachmentId)

    if (dbError) return { ok: false, error: dbError.message }
    return { ok: true }
  }

  return { uploadAttachments, copyProjectAttachmentsToTask, getTaskAttachments, getAttachmentUrl, deleteAttachment }
}
