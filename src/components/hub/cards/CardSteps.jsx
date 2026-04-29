import { useState } from 'react'
import { Check, Plus, X } from 'lucide-react'
import { useHubCardSteps } from '../../../hooks/useHubCardSteps'

export default function CardSteps({ cardId }) {
  const { steps, addStep, toggleStep, deleteStep } = useHubCardSteps(cardId)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  return (
    <div className="space-y-1">
      {steps.map(s => (
        <div key={s.id} className="flex items-center gap-2 group">
          <button
            type="button"
            onClick={() => toggleStep(s.id, !s.completed_at)}
            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${s.completed_at ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 dark:border-slate-600'}`}
            aria-label={s.completed_at ? 'Mark incomplete' : 'Mark complete'}
          >
            {s.completed_at && <Check size={11} />}
          </button>
          <span className={`text-sm flex-1 ${s.completed_at ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
            {s.label}
          </span>
          <button type="button" onClick={() => deleteStep(s.id)}
            className="p-0.5 rounded text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100" aria-label="Delete step">
            <X size={12} />
          </button>
        </div>
      ))}
      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={async e => {
            if (e.key === 'Enter' && draft.trim()) { await addStep(draft.trim()); setDraft(''); setAdding(false) }
            if (e.key === 'Escape') { setDraft(''); setAdding(false) }
          }}
          onBlur={() => { setDraft(''); setAdding(false) }}
          placeholder="Add a step…"
          className="form-input text-sm w-full"
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-brand-500 mt-1">
          <Plus size={12} /> Add step
        </button>
      )}
    </div>
  )
}
