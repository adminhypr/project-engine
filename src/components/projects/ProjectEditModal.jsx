import { useState, useEffect } from 'react'
import { ModalWrapper } from '../ui/animations'
import { showToast } from '../ui'

// Edit a project's name/description. Only rendered for project owner/admin —
// RLS (projects_update, migration 106) enforces the same gate server-side.
export default function ProjectEditModal({ isOpen, onClose, project, onSave }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setName(project?.name || '')
      setDescription(project?.description || '')
    }
  }, [isOpen, project])

  const submit = async () => {
    if (!name.trim()) { showToast('Project name is required', 'error'); return }
    setBusy(true)
    const ok = await onSave({ name: name.trim(), description: description.trim() || null })
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose}>
      <div className="bg-white dark:bg-dark-card rounded-2xl w-full max-w-md p-5 shadow-elevated">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Edit Project</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Name</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              className="form-input w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="form-input w-full resize-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={submit} disabled={busy} className="btn-primary">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </ModalWrapper>
  )
}
