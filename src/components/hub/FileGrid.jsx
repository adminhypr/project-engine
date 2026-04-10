import { useState } from 'react'
import { Folder, File, Image, FileText, Film, Music, Archive, Trash2, Download } from 'lucide-react'

const MIME_ICONS = {
  image: Image,
  video: Film,
  audio: Music,
  'application/pdf': FileText,
  'application/zip': Archive,
  'application/x-zip': Archive,
}

function getFileIcon(mimeType) {
  if (!mimeType) return File
  for (const [key, icon] of Object.entries(MIME_ICONS)) {
    if (mimeType.startsWith(key) || mimeType === key) return icon
  }
  return File
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export default function FileGrid({ folders, files, onFolderClick, onDeleteFile, onDeleteFolder, onGetFileUrl }) {
  const [downloading, setDownloading] = useState(null)

  async function handleDownload(file) {
    setDownloading(file.id)
    const url = await onGetFileUrl(file.storage_path)
    if (url) window.open(url, '_blank')
    setDownloading(null)
  }

  return (
    <div className="space-y-1">
      {/* Folders */}
      {folders.map(folder => (
        <div
          key={folder.id}
          className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors cursor-pointer group"
          onClick={() => onFolderClick(folder)}
        >
          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: (folder.color || '#6366f1') + '15' }}>
            <Folder size={16} style={{ color: folder.color || '#6366f1' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{folder.name}</p>
          </div>
          <button
            onClick={e => { e.stopPropagation(); onDeleteFolder(folder.id) }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}

      {/* Files */}
      {files.map(file => {
        const FileIcon = getFileIcon(file.mime_type)
        const isImage = file.mime_type?.startsWith('image/')

        return (
          <div
            key={file.id}
            className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-slate-50 dark:hover:bg-dark-hover transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-dark-border flex items-center justify-center shrink-0">
              <FileIcon size={16} className="text-slate-500 dark:text-slate-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-800 dark:text-slate-200 truncate">{file.file_name}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                {formatSize(file.file_size)}
                {file.uploader?.full_name && <> &middot; {file.uploader.full_name}</>}
              </p>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleDownload(file)}
                disabled={downloading === file.id}
                className="p-1 rounded-lg text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:hover:bg-brand-500/10 transition-all"
              >
                <Download size={13} />
              </button>
              <button
                onClick={() => onDeleteFile(file.id, file.storage_path)}
                className="p-1 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
