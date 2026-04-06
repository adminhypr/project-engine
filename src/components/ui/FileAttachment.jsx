import { useState } from 'react'
import { Paperclip, X, FileText, Image, File, Download, Trash2, AlertTriangle } from 'lucide-react'
import { MAX_FILE_SIZE, validateFiles, formatFileSize } from '../../hooks/useAttachments'
import { showToast } from './index'

function fileIcon(mimeType) {
  if (mimeType?.startsWith('image/')) return Image
  if (mimeType?.includes('pdf') || mimeType?.startsWith('text/')) return FileText
  return File
}

export function hasOversizedFiles(files) {
  return files.some(f => f.size > MAX_FILE_SIZE)
}

// ── File picker for pending uploads ──────────────────────────────
export function FilePickerInput({ files, onChange, compact = false }) {
  const inputId = `file-picker-${Math.random().toString(36).slice(2, 8)}`

  function handleSelect(e) {
    const selected = Array.from(e.target.files || [])
    if (!selected.length) return
    onChange([...files, ...selected])
    e.target.value = ''
  }

  function remove(index) {
    onChange(files.filter((_, i) => i !== index))
  }

  const anyOversized = hasOversizedFiles(files)

  return (
    <div className={compact ? '' : 'mt-3'}>
      <label
        htmlFor={inputId}
        className="inline-flex items-center gap-1.5 text-sm text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 cursor-pointer transition-colors"
      >
        <Paperclip size={15} />
        <span>Attach files</span>
      </label>
      <input
        id={inputId}
        type="file"
        multiple
        className="hidden"
        onChange={handleSelect}
      />

      {files.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {files.map((file, i) => {
            const Icon = fileIcon(file.type)
            const isOversized = file.size > MAX_FILE_SIZE
            return (
              <div
                key={`${file.name}-${i}`}
                className={`flex items-center gap-2 text-sm rounded-lg px-3 py-1.5 ${
                  isOversized
                    ? 'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30'
                    : 'bg-slate-50 dark:bg-dark-card border border-slate-200/60 dark:border-dark-border'
                }`}
              >
                {isOversized
                  ? <AlertTriangle size={14} className="text-red-500 shrink-0" />
                  : <Icon size={14} className="text-slate-400 shrink-0" />
                }
                <span className={`truncate ${isOversized ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>
                  {file.name}
                </span>
                <span className={`text-xs shrink-0 ${isOversized ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                  {formatFileSize(file.size)}
                </span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  className="ml-auto text-slate-400 hover:text-red-500 transition-colors shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
          {anyOversized && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1 mt-1">
              <AlertTriangle size={12} />
              Files over 5 MB cannot be attached. Upload to Google Drive and share the link instead. Remove oversized files to continue.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ── List of existing attachments ──────────────────────────────
export function AttachmentList({ attachments, onDownload, onDelete, currentUserId, isAdmin }) {
  const [deleting, setDeleting] = useState(null)

  async function handleDownload(attachment) {
    const result = await onDownload(attachment.storage_path)
    if (result?.ok) {
      window.open(result.url, '_blank')
    } else {
      showToast('Failed to download file', 'error')
    }
  }

  async function handleDelete(attachment) {
    setDeleting(attachment.id)
    const result = await onDelete(attachment.id, attachment.storage_path)
    if (!result?.ok) {
      showToast('Failed to delete file', 'error')
    }
    setDeleting(null)
  }

  if (!attachments?.length) return null

  return (
    <div className="space-y-1.5">
      {attachments.map((att) => {
        const Icon = fileIcon(att.mime_type)
        const canDelete = isAdmin || att.uploaded_by === currentUserId

        return (
          <div
            key={att.id}
            className="flex items-center gap-2 text-sm bg-slate-50 dark:bg-dark-card border border-slate-200/60 dark:border-dark-border rounded-lg px-3 py-1.5 group"
          >
            <Icon size={14} className="text-slate-400 shrink-0" />
            <button
              type="button"
              onClick={() => handleDownload(att)}
              className="truncate text-slate-700 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 transition-colors text-left"
            >
              {att.file_name}
            </button>
            <span className="text-xs text-slate-400 shrink-0">{formatFileSize(att.file_size)}</span>
            {att.uploader?.full_name && (
              <span className="text-xs text-slate-400 shrink-0 hidden sm:inline">
                — {att.uploader.full_name}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => handleDownload(att)}
                className="text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors opacity-0 group-hover:opacity-100"
                title="Download"
              >
                <Download size={14} />
              </button>
              {canDelete && (
                <button
                  type="button"
                  onClick={() => handleDelete(att)}
                  disabled={deleting === att.id}
                  className="text-slate-400 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Inline attachment chips for comments ──────────────────────────────
export function CommentAttachments({ attachments, onDownload }) {
  if (!attachments?.length) return null

  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {attachments.map((att) => {
        const Icon = fileIcon(att.mime_type)
        return (
          <button
            key={att.id}
            type="button"
            onClick={async () => {
              const result = await onDownload(att.storage_path)
              if (result?.ok) window.open(result.url, '_blank')
              else showToast('Failed to download file', 'error')
            }}
            className="inline-flex items-center gap-1 text-xs bg-slate-100 dark:bg-dark-border text-slate-600 dark:text-slate-300 hover:text-brand-600 dark:hover:text-brand-400 rounded-md px-2 py-0.5 transition-colors"
          >
            <Icon size={12} />
            <span className="truncate max-w-[120px]">{att.file_name}</span>
          </button>
        )
      })}
    </div>
  )
}
