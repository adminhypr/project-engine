import { useState } from 'react'
import { useHubFiles } from '../../hooks/useHubFiles'
import { Spinner } from '../ui/index'
import FolderBreadcrumb from './FolderBreadcrumb'
import FileGrid from './FileGrid'
import FileUploadZone from './FileUploadZone'
import CreateFolderModal from './CreateFolderModal'
import { FolderPlus } from 'lucide-react'

export default function DocsFiles({ hubId }) {
  const [folderPath, setFolderPath] = useState([]) // [{ id, name }, ...]
  const currentFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null

  const { files, folders, loading, uploadFiles, createFolder, deleteFile, deleteFolder, getFileUrl } = useHubFiles(hubId, currentFolderId)
  const [showNewFolder, setShowNewFolder] = useState(false)

  function navigateToFolder(folder) {
    setFolderPath(prev => [...prev, { id: folder.id, name: folder.name }])
  }

  function navigateUp(index) {
    setFolderPath(prev => prev.slice(0, index))
  }

  if (loading) return <div className="py-8 flex justify-center"><Spinner /></div>

  return (
    <div className="space-y-3">
      <FolderBreadcrumb path={folderPath} onNavigate={navigateUp} />

      <FileUploadZone onUpload={uploadFiles} />

      <div className="flex gap-2">
        <button onClick={() => setShowNewFolder(true)} className="btn btn-ghost text-xs flex items-center gap-1">
          <FolderPlus size={14} />
          New folder
        </button>
      </div>

      {showNewFolder && (
        <CreateFolderModal
          onSubmit={async (name, color) => {
            const ok = await createFolder(name, color)
            if (ok) setShowNewFolder(false)
          }}
          onClose={() => setShowNewFolder(false)}
        />
      )}

      <FileGrid
        folders={folders}
        files={files}
        onFolderClick={navigateToFolder}
        onDeleteFile={deleteFile}
        onDeleteFolder={deleteFolder}
        onGetFileUrl={getFileUrl}
      />

      {folders.length === 0 && files.length === 0 && (
        <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">
          No files or folders yet. Upload something or create a folder.
        </p>
      )}
    </div>
  )
}
