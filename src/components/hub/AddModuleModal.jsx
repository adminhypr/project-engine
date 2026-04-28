import { useState } from 'react'
import { ModalWrapper } from '../ui/animations'
import { MessageSquare, CheckSquare, Flame, FolderOpen, Users, X as XIcon } from 'lucide-react'
import { HUB_MODULE_KINDS, HUB_MODULE_DEFAULT_TITLE } from '../../hooks/useHubModules'

const KIND_META = {
  'message-board':   { label: 'Message Board',   icon: MessageSquare, color: '#7c3aed', desc: 'Long-form announcements + threads' },
  'attendance-room': { label: "Who's Here",      icon: Users,         color: '#8b5cf6', desc: 'Live presence — who is online now' },
  'campfire':        { label: 'Campfire',        icon: Flame,         color: '#dc2626', desc: 'Real-time chat for quick conversation' },
  'docs-files':      { label: 'Docs & Files',    icon: FolderOpen,    color: '#0284c7', desc: 'Shared folders + file uploads' },
  'to-dos':          { label: 'To-Dos',          icon: CheckSquare,   color: '#8b5cf6', desc: 'Lists of trackable tasks' },
}

export default function AddModuleModal({ isOpen, onClose, onSubmit }) {
  const [kind, setKind] = useState(null)
  const [title, setTitle] = useState('')
  const [columnIndex, setColumnIndex] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  function pickKind(k) {
    setKind(k)
    setTitle(HUB_MODULE_DEFAULT_TITLE[k] || '')
  }

  async function handleSubmit() {
    if (!kind || submitting) return
    setSubmitting(true)
    const ok = await onSubmit({ kind, title: title.trim() || HUB_MODULE_DEFAULT_TITLE[kind], columnIndex })
    setSubmitting(false)
    if (ok) {
      setKind(null); setTitle(''); setColumnIndex(0)
      onClose()
    }
  }

  function handleClose() {
    if (submitting) return
    setKind(null); setTitle(''); setColumnIndex(0)
    onClose()
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={handleClose}>
      <div className="bg-white dark:bg-dark-card rounded-2xl shadow-elevated p-5 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Add a module</h2>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-dark-hover"
            disabled={submitting}
          >
            <XIcon size={15} />
          </button>
        </div>

        <div className="space-y-2 mb-4">
          {HUB_MODULE_KINDS.map(k => {
            const m = KIND_META[k]
            const Icon = m.icon
            const selected = kind === k
            return (
              <button
                key={k}
                type="button"
                onClick={() => pickKind(k)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                  selected
                    ? 'border-brand-400 bg-brand-50 dark:bg-brand-500/10 dark:border-brand-500/40'
                    : 'border-slate-200 dark:border-dark-border hover:bg-slate-50 dark:hover:bg-dark-hover'
                }`}
              >
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: `${m.color}18` }}
                >
                  <Icon size={16} style={{ color: m.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{m.label}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{m.desc}</div>
                </div>
              </button>
            )
          })}
        </div>

        {kind && (
          <>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={80}
              placeholder={HUB_MODULE_DEFAULT_TITLE[kind]}
              className="form-input w-full text-sm mb-3"
            />

            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Column</label>
            <div className="flex gap-2 mb-4">
              {[0, 1, 2].map(i => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setColumnIndex(i)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${
                    columnIndex === i
                      ? 'border-brand-400 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:border-brand-500/40 dark:text-brand-300'
                      : 'border-slate-200 dark:border-dark-border text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover'
                  }`}
                >
                  Column {i + 1}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="btn btn-ghost text-sm px-4"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!kind || submitting}
            className="btn btn-primary text-sm px-4"
          >
            {submitting ? 'Adding…' : 'Add module'}
          </button>
        </div>
      </div>
    </ModalWrapper>
  )
}
