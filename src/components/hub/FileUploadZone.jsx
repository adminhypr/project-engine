import { useState, useRef } from 'react'
import { Upload } from 'lucide-react'

export default function FileUploadZone({ onUpload }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef(null)

  async function handleFiles(files) {
    if (!files?.length || uploading) return
    setUploading(true)
    await onUpload(Array.from(files))
    setUploading(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  function handleDragOver(e) {
    e.preventDefault()
    setDragging(true)
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={() => setDragging(false)}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors
        ${dragging
          ? 'border-brand-400 bg-brand-50 dark:bg-brand-500/10'
          : 'border-slate-200 dark:border-dark-border hover:border-slate-300 dark:hover:border-slate-600'
        }
        ${uploading ? 'opacity-50 pointer-events-none' : ''}
      `}
    >
      <Upload size={20} className="mx-auto text-slate-400 mb-1" />
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {uploading ? 'Uploading...' : 'Drop files here or click to upload'}
      </p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Max 10 MB per file</p>
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={e => handleFiles(e.target.files)}
        className="hidden"
      />
    </div>
  )
}
