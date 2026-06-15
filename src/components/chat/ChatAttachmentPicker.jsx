import { useRef, useState } from 'react'
import { Paperclip, X, Loader2, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { showToast } from '../ui/index'
import {
  sanitizeFilename,
  attachmentStoragePath,
  buildAttachmentDescriptor,
  formatFileSize,
} from '../../lib/chatAttachments'

const MAX_FILE_SIZE = 25 * 1024 * 1024 // matches migration 105 dm-attachments cap

// Generic file attachment picker for chat composers (campfire + widget).
// Any file type is allowed — files upload immediately to the dm-attachments
// bucket at `{conversationId}/{uuid}/{name}` (required by the 027 RLS) and
// the descriptors flow up via onChange. Non-executable safety is enforced
// at RENDER time (forced-download signed URLs), not here. Inline image
// previews are handled by each composer's existing image flow, not this.
//
// `attachments` shape: [{ storage_path, file_name, mime_type, size }]
export default function ChatAttachmentPicker({ conversationId, attachments = [], onChange, disabled = false }) {
  const fileInputRef = useRef(null)
  const [uploading, setUploading] = useState([]) // [{ id, name }]

  async function uploadFile(file) {
    if (!file) return
    if (file.size === 0) { showToast(`${file.name || 'File'} is empty`, 'error'); return }
    if (file.size > MAX_FILE_SIZE) { showToast(`${file.name || 'File'} exceeds 25 MB limit`, 'error'); return }
    if (!conversationId) { showToast('Cannot attach yet — chat still loading', 'error'); return }

    const tempId = crypto.randomUUID()
    const safeName = sanitizeFilename(file.name)
    setUploading(prev => [...prev, { id: tempId, name: safeName }])

    const storagePath = attachmentStoragePath(conversationId, crypto.randomUUID(), file.name)
    const { error } = await supabase.storage
      .from('dm-attachments')
      .upload(storagePath, file, { contentType: file.type || undefined })

    setUploading(prev => prev.filter(u => u.id !== tempId))
    if (error) { showToast('Upload failed', 'error'); return }

    onChange?.([...attachments, buildAttachmentDescriptor({ storage_path: storagePath, file })])
  }

  function handlePickerChange(e) {
    const files = e.target.files
    if (!files) return
    for (const file of files) uploadFile(file)
    e.target.value = '' // allow re-picking the same file
  }

  function handleRemove(index) {
    const att = attachments[index]
    if (!att) return
    // Best-effort storage cleanup; don't block removal on failure.
    supabase.storage.from('dm-attachments').remove([att.storage_path]).then(() => {})
    onChange?.(attachments.filter((_, i) => i !== index))
  }

  const hasAny = attachments.length > 0 || uploading.length > 0

  return (
    <div className="space-y-1.5">
      {hasAny && (
        <div className="flex flex-wrap gap-1.5">
          {attachments.map((att, i) => (
            <div
              key={`${att.storage_path}-${i}`}
              className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-dark-bg/50 border border-slate-200 dark:border-dark-border text-xs"
            >
              <FileText size={12} className="shrink-0 text-slate-400" />
              <span className="text-slate-700 dark:text-slate-300 truncate max-w-[160px]" title={att.file_name}>
                {att.file_name}
              </span>
              {att.size != null && <span className="text-slate-400 shrink-0">({formatFileSize(att.size)})</span>}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleRemove(i)}
                  className="ml-0.5 p-0.5 rounded text-slate-300 hover:text-red-500"
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
              <span className="truncate max-w-[160px]">{u.name}</span>
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <>
          <input ref={fileInputRef} type="file" multiple hidden onChange={handlePickerChange} />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 text-slate-400 hover:text-brand-600 dark:text-slate-500 dark:hover:text-brand-400"
            aria-label="Attach file"
            title="Attach file (max 25 MB)"
          >
            <Paperclip size={15} />
          </button>
        </>
      )}
    </div>
  )
}
