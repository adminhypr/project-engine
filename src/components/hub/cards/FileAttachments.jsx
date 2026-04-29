import { useRef, useState } from 'react'
import { Paperclip, X, Loader2, Download } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { showToast } from '../../ui/index'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const FILENAME_MAX = 80

function sanitizeFilename(name) {
  const base = (name || 'file').replace(/[^A-Za-z0-9._-]/g, '_')
  if (base.length <= FILENAME_MAX) return base
  // Preserve extension when trimming.
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

// Generic non-image file attachment list. Used by Card notes and per-comment.
// Inline screenshots/images do NOT go through here — they ride the existing
// RichInput inlineImages flow (`hub-files` bucket, signed URL render).
//
// `attachments` shape: [{ storage_path, file_name, mime_type, size }]
export default function FileAttachments({
  attachments = [],
  onChange,
  cardId,
  disabled = false,
}) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState([]) // [{ id, name }]

  async function uploadFile(file) {
    if (!file) return
    if (file.size === 0) {
      showToast(`${file.name || 'File'} is empty`, 'error')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      showToast(`${file.name || 'File'} exceeds 10 MB limit`, 'error')
      return
    }
    if (!cardId) return

    const tempId = crypto.randomUUID()
    const safeName = sanitizeFilename(file.name)
    setUploading(prev => [...prev, { id: tempId, name: safeName }])

    const storagePath = `card-attachments/${cardId}/${crypto.randomUUID()}-${safeName}`
    const { error } = await supabase.storage
      .from('hub-files')
      .upload(storagePath, file, { contentType: file.type || undefined })

    setUploading(prev => prev.filter(u => u.id !== tempId))

    if (error) {
      showToast('Upload failed', 'error')
      return
    }

    onChange?.([
      ...attachments,
      {
        storage_path: storagePath,
        file_name: safeName,
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
      },
    ])
  }

  function handlePickerChange(e) {
    const files = e.target.files
    if (!files) return
    for (const file of files) uploadFile(file)
    e.target.value = ''
  }

  async function handleDownload(att) {
    const { data, error } = await supabase.storage
      .from('hub-files')
      .createSignedUrl(att.storage_path, 3600)
    if (error || !data?.signedUrl) {
      showToast('Could not open file', 'error')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  async function handleRemove(index) {
    const att = attachments[index]
    if (!att) return
    // Best-effort storage cleanup; don't block removal on failure.
    supabase.storage.from('hub-files').remove([att.storage_path]).then(() => {})
    onChange?.(attachments.filter((_, i) => i !== index))
  }

  const hasAny = attachments.length > 0 || uploading.length > 0

  return (
    <div className="space-y-2">
      {hasAny && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((att, i) => (
            <div
              key={`${att.storage_path}-${i}`}
              className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-dark-bg/50 border border-slate-200 dark:border-dark-border text-xs"
            >
              <button
                type="button"
                onClick={() => handleDownload(att)}
                className="inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 max-w-[260px]"
                title={`Download ${att.file_name}`}
              >
                <Download size={12} className="shrink-0 text-slate-400" />
                <span className="truncate">{att.file_name}</span>
                {att.size != null && (
                  <span className="text-slate-400 shrink-0">({formatSize(att.size)})</span>
                )}
              </button>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemove(i)}
                  className="ml-0.5 p-0.5 rounded text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label={`Remove ${att.file_name}`}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          ))}
          {uploading.map(u => (
            <div
              key={u.id}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-dark-bg/50 border border-slate-200 dark:border-dark-border text-xs text-slate-500"
            >
              <Loader2 size={12} className="animate-spin text-brand-500" />
              <span className="truncate max-w-[200px]">{u.name}</span>
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={handlePickerChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-slate-500 dark:text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-slate-50 dark:hover:bg-dark-hover border border-dashed border-slate-300 dark:border-dark-border"
            title="Attach file (max 10 MB)"
          >
            <Paperclip size={12} />
            Attach file
          </button>
        </>
      )}
    </div>
  )
}
