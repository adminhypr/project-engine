import { useState } from 'react'
import { ModalWrapper } from '../ui/animations'
import { X } from 'lucide-react'

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

export default function CreateHubModal({ onSubmit, onClose }) {
  const [name, setName]   = useState('')
  const [desc, setDesc]   = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    await onSubmit({ name: name.trim(), description: desc.trim() || null, icon: null, color })
    setSaving(false)
  }

  return (
    <ModalWrapper isOpen onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-dark-border">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">Create a Hub</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="form-label">Hub name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. OPS Team, Design Sprint, Q2 Campaign" className="form-input w-full" autoFocus />
          </div>
          <div>
            <label className="form-label">Description (optional)</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What's this hub for?" className="form-input w-full" />
          </div>
          <div>
            <label className="form-label">Color</label>
            <div className="flex items-center gap-2 mt-1">
              {COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-offset-2 ring-slate-300 dark:ring-slate-600 dark:ring-offset-dark-card' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 dark:border-dark-border flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost text-sm">Cancel</button>
          <button type="submit" disabled={!name.trim() || saving} className="btn btn-primary text-sm disabled:opacity-40">
            {saving ? 'Creating...' : 'Create Hub'}
          </button>
        </div>
      </form>
    </ModalWrapper>
  )
}
