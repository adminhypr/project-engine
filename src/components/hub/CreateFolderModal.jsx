import { useState } from 'react'

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4']

export default function CreateFolderModal({ onSubmit, onClose }) {
  const [name, setName]   = useState('')
  const [color, setColor] = useState(COLORS[0])

  function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) return
    onSubmit(name.trim(), color)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200/60 dark:border-dark-border bg-white dark:bg-dark-card p-4 space-y-3">
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Folder name"
        className="form-input w-full text-sm"
        autoFocus
      />
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-500 dark:text-slate-400 mr-1">Color:</span>
        {COLORS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-offset-1 ring-slate-300 dark:ring-slate-600' : 'hover:scale-110'}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="btn btn-ghost text-xs">Cancel</button>
        <button type="submit" disabled={!name.trim()} className="btn btn-primary text-xs disabled:opacity-40">Create folder</button>
      </div>
    </form>
  )
}
