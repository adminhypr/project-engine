import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { ModalWrapper } from '../ui/animations'

// Double-verify destructive modal — user must type the exact hub name
// to enable the Delete button. Used pattern by GitHub / Slack / Linear
// for irreversible operations on named entities; protects against
// accidental clicks much better than a single "Are you sure?" confirm.
//
// Props:
//   isOpen   : boolean
//   onClose  : () => void
//   onConfirm: () => Promise<boolean>   — should perform the delete and
//                                         return true on success.
//   hubName  : string                   — used both for display and as
//                                         the required confirmation text.
export default function DeleteHubModal({ isOpen, onClose, onConfirm, hubName }) {
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  const inputRef = useRef(null)

  // Reset typed text + focus the input every time the modal opens. Without
  // this, reopening the modal would still show whatever the user typed
  // last time (which would be a free-pass to delete).
  useEffect(() => {
    if (isOpen) {
      setTyped('')
      setDeleting(false)
      // Allow ModalWrapper to mount before focusing
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  const matches = typed.trim() === (hubName || '').trim() && hubName.length > 0
  const disabled = !matches || deleting

  async function handleConfirm() {
    if (disabled) return
    setDeleting(true)
    const ok = await onConfirm()
    setDeleting(false)
    if (ok) onClose()
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose}>
      <div className="p-6 max-w-md">
        <div className="flex items-start gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-500/15 flex items-center justify-center text-red-600 shrink-0">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              Delete hub
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              This permanently removes the hub and everything inside it — all
              modules, messages, to-dos, files, and members. This cannot be
              undone.
            </p>
          </div>
        </div>

        <label className="block mt-4 text-sm">
          <span className="text-slate-700 dark:text-slate-300">
            Type{' '}
            <span className="font-mono font-semibold text-red-600 dark:text-red-400">
              {hubName}
            </span>{' '}
            to confirm:
          </span>
          <input
            ref={inputRef}
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches) handleConfirm()
              if (e.key === 'Escape') onClose()
            }}
            disabled={deleting}
            placeholder={hubName}
            className="form-input mt-1.5 w-full font-mono text-sm"
            autoComplete="off"
            spellCheck={false}
          />
        </label>

        <div className="flex gap-2 justify-end mt-5">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={deleting}
          >
            Cancel
          </button>
          <motion.button
            type="button"
            className="btn-danger"
            onClick={handleConfirm}
            disabled={disabled}
            whileTap={!disabled ? { scale: 0.97 } : undefined}
          >
            {deleting ? 'Deleting…' : 'Delete hub'}
          </motion.button>
        </div>
      </div>
    </ModalWrapper>
  )
}
