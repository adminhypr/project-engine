import { useState } from 'react'
import { Plus } from 'lucide-react'

export default function AddColumnInline({ onAdd }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="self-start flex items-center gap-1.5 px-3 py-2 text-xs text-slate-500 hover:text-brand-500 hover:bg-white dark:hover:bg-dark-card rounded-xl transition-colors min-w-[180px]">
        <Plus size={12} /> Add column
      </button>
    )
  }
  return (
    <div className="self-start min-w-[220px]">
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === 'Enter' && name.trim()) {
            await onAdd(name.trim())
            setName(''); setOpen(false)
          }
          if (e.key === 'Escape') { setName(''); setOpen(false) }
        }}
        onBlur={() => { setName(''); setOpen(false) }}
        placeholder="Column name"
        className="form-input text-sm w-full"
      />
    </div>
  )
}
