import { useRef, useState, useEffect } from 'react'
import { Paperclip, X, Loader2, Download, ImageOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { showToast } from '../ui/index'
import { isBlockedImageType } from '../../lib/uploadGuards'

const BUCKET = 'project-attachments'
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const FILENAME_MAX = 80

function sanitizeFilename(name) {
  const base = (name || 'file').replace(/[^A-Za-z0-9._-]/g, '_')
  if (base.length <= FILENAME_MAX) return base
  const dot = base.lastIndexOf('.')
  if (dot > 0 && dot >= base.length - 12) {
    const ext = base.slice(dot)
    return base.slice(0, FILENAME_MAX - ext.length) + ext
  }
  return base.slice(0, FILENAME_MAX)
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const isImage = (att) => (att?.mime_type || '').startsWith('image/')

// Attachments on a bug / feature request. Mirrors the Card FileAttachments
// component but targets the `project-attachments` bucket and renders image
// previews as thumbnails. Files live at `{projectId}/{entityKind}/{entityId}/…`
// so migration 110's project-member storage RLS applies.
//
// `attachments` shape: [{ storage_path, file_name, mime_type, size }]
export default function ProjectAttachments({
  attachments = [],
  onChange,
  projectId,
  entityKind,   // 'bug' | 'request'
  entityId,
  disabled = false,
}) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState([]) // [{ id, name }]
  const [previews, setPreviews] = useState({})    // { storage_path: signedUrl } for images

  // Fetch signed URLs for image attachments so we can show thumbnails (private
  // bucket — no public URL). Re-runs as attachments change; skips ones already
  // resolved.
  useEffect(() => {
    let cancelled = false
    // `previews[path] === undefined` = not attempted; `null` = attempted but
    // failed. Filter on key-presence (not truthiness) so a failed sign DOESN'T
    // get retried every render — that was an infinite refetch loop.
    const need = attachments.filter(a => isImage(a) && !(a.storage_path in previews))
    if (need.length === 0) return
    ;(async () => {
      const entries = await Promise.all(need.map(async (a) => {
        const { data } = await supabase.storage.from(BUCKET).createSignedUrl(a.storage_path, 3600)
        return [a.storage_path, data?.signedUrl || null]
      }))
      if (cancelled) return
      setPreviews(prev => {
        const next = { ...prev }
        for (const [path, url] of entries) next[path] = url  // record null too → no retry loop
        return next
      })
    })()
    return () => { cancelled = true }
  }, [attachments, previews])

  async function uploadOne(file) {
    if (!file) return null
    if (file.size === 0) { showToast(`${file.name || 'File'} is empty`, 'error'); return null }
    if (file.size > MAX_FILE_SIZE) { showToast(`${file.name || 'File'} exceeds 10 MB limit`, 'error'); return null }
    if (isBlockedImageType(file)) { showToast('SVG images are not allowed', 'error'); return null }
    if (!projectId || !entityId) return null

    const tempId = crypto.randomUUID()
    const safeName = sanitizeFilename(file.name)
    setUploading(prev => [...prev, { id: tempId, name: safeName }])

    // Path MUST start with `${projectId}/...` — migration 110's storage RLS
    // extracts the project id from the leading folder to scope reads/writes.
    const storagePath = `${projectId}/${entityKind}/${entityId}/${crypto.randomUUID()}-${safeName}`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file, { contentType: file.type || undefined })

    setUploading(prev => prev.filter(u => u.id !== tempId))
    if (error) { showToast('Upload failed', 'error'); return null }

    return {
      storage_path: storagePath,
      file_name: safeName,
      mime_type: file.type || 'application/octet-stream',
      size: file.size,
    }
  }

  // Upload all picked files, then commit them in a SINGLE onChange. Calling
  // onChange per-file would build each payload from the same stale `attachments`
  // closure → last-writer-wins → all but one file dropped from the row.
  async function handlePickerChange(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    const added = []
    for (const file of files) {
      const meta = await uploadOne(file)
      if (meta) added.push(meta)
    }
    if (added.length) onChange?.([...attachments, ...added])
  }

  async function openAttachment(att) {
    const url = previews[att.storage_path]
    if (url) { window.open(url, '_blank', 'noopener,noreferrer'); return }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(att.storage_path, 3600)
    if (error || !data?.signedUrl) { showToast('Could not open file', 'error'); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  function handleRemove(index) {
    const att = attachments[index]
    if (!att) return
    supabase.storage.from(BUCKET).remove([att.storage_path]).then(() => {}).catch(() => {}) // best-effort
    onChange?.(attachments.filter((_, i) => i !== index))
  }

  const hasAny = attachments.length > 0 || uploading.length > 0

  return (
    <div className="space-y-2">
      {hasAny && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((att, i) => (
            isImage(att) ? (
              <div key={`${att.storage_path}-${i}`} className="group relative">
                <button type="button" onClick={() => openAttachment(att)} title={att.file_name}
                  className="block w-14 h-14 rounded-lg overflow-hidden border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-dark-bg/50">
                  {previews[att.storage_path]
                    ? <img src={previews[att.storage_path]} alt={att.file_name} className="w-full h-full object-cover" />
                    : (att.storage_path in previews
                        ? <span className="w-full h-full grid place-items-center text-slate-400" title="Preview unavailable"><ImageOff size={14} /></span>
                        : <span className="w-full h-full grid place-items-center"><Loader2 size={14} className="animate-spin text-brand-500" /></span>)}
                </button>
                {!disabled && (
                  <button type="button" onClick={() => handleRemove(i)} aria-label={`Remove ${att.file_name}`}
                    className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity shadow-soft">
                    <X size={11} />
                  </button>
                )}
              </div>
            ) : (
              <div key={`${att.storage_path}-${i}`}
                className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-dark-bg/50 border border-slate-200 dark:border-dark-border text-xs">
                <button type="button" onClick={() => openAttachment(att)} title={`Download ${att.file_name}`}
                  className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 max-w-[220px]">
                  <Download size={12} className="shrink-0 text-slate-400" />
                  <span className="truncate">{att.file_name}</span>
                  {att.size != null && <span className="text-slate-400 shrink-0">({formatSize(att.size)})</span>}
                </button>
                {!disabled && (
                  <button type="button" onClick={() => handleRemove(i)} aria-label={`Remove ${att.file_name}`}
                    className="ml-0.5 p-0.5 rounded text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                    <X size={11} />
                  </button>
                )}
              </div>
            )
          ))}
          {uploading.map(u => (
            <div key={u.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-dark-bg/50 border border-slate-200 dark:border-dark-border text-xs text-slate-500">
              <Loader2 size={12} className="animate-spin text-brand-500" />
              <span className="truncate max-w-[160px]">{u.name}</span>
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <>
          <input ref={fileInputRef} type="file" multiple hidden onChange={handlePickerChange} />
          <button type="button" onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-slate-50 dark:hover:bg-dark-hover border border-dashed border-slate-300 dark:border-dark-border"
            title="Attach file or image (max 10 MB)">
            <Paperclip size={12} /> Attach file/image
          </button>
        </>
      )}
    </div>
  )
}
