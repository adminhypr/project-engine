import { useState } from 'react'
import { ModalWrapper } from './animations'

// Styled replacement for window.confirm on destructive actions. Inherits
// Escape-to-close, backdrop click, and focus restore from ModalWrapper.
export default function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = 'Delete',
  busyLabel = 'Deleting…',
  onConfirm,
  onCancel,
}) {
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalWrapper isOpen={open} onClose={busy ? () => {} : onCancel}>
      <div className="p-5">
        <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">{title}</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">{body}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn btn-ghost text-sm px-4" disabled={busy}>
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className="btn text-sm px-4 bg-red-500 hover:bg-red-600 text-white disabled:opacity-60"
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </ModalWrapper>
  )
}
