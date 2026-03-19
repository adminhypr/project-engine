import { useState } from 'react'
import { motion } from 'framer-motion'
import { ModalWrapper } from '../ui/animations'

export default function DeclineModal({ isOpen, onClose, onConfirm, taskTitle }) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    setSubmitting(true)
    await onConfirm(reason.trim() || null)
    setSubmitting(false)
    setReason('')
    onClose()
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose}>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-navy-900 mb-1">Decline Task</h3>
        <p className="text-sm text-navy-500 mb-4">
          {taskTitle ? (
            <>Are you sure you want to decline "<span className="font-medium">{taskTitle}</span>"?</>
          ) : (
            'Are you sure you want to decline this task?'
          )}
        </p>

        <div className="mb-4">
          <label className="form-label">Reason (optional)</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Why are you declining this task..."
            rows={3}
            className="form-input resize-none"
            autoFocus
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            className="btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <motion.button
            className="btn-danger"
            onClick={handleConfirm}
            disabled={submitting}
            whileTap={{ scale: 0.97 }}
          >
            {submitting ? 'Declining...' : 'Decline Task'}
          </motion.button>
        </div>
      </div>
    </ModalWrapper>
  )
}
