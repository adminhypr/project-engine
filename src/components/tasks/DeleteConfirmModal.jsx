import { useState } from 'react'
import { motion } from 'framer-motion'
import { ModalWrapper } from '../ui/animations'

export default function DeleteConfirmModal({ isOpen, onClose, onConfirm, taskTitle, count = 1 }) {
  const [deleting, setDeleting] = useState(false)

  async function handleConfirm() {
    setDeleting(true)
    await onConfirm()
    setDeleting(false)
    onClose()
  }

  const isBulk = count > 1

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose}>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
          {isBulk ? `Delete ${count} Tasks` : 'Delete Task'}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          {isBulk ? (
            <>Are you sure you want to permanently delete <span className="font-medium">{count} tasks</span>? This cannot be undone.</>
          ) : taskTitle ? (
            <>Are you sure you want to permanently delete "<span className="font-medium">{taskTitle}</span>"? This cannot be undone.</>
          ) : (
            'Are you sure you want to permanently delete this task? This cannot be undone.'
          )}
        </p>

        <div className="flex gap-2 justify-end">
          <button
            className="btn-secondary"
            onClick={onClose}
            disabled={deleting}
          >
            Cancel
          </button>
          <motion.button
            className="btn-danger"
            onClick={handleConfirm}
            disabled={deleting}
            whileTap={{ scale: 0.97 }}
          >
            {deleting ? 'Deleting...' : isBulk ? `Delete ${count} Tasks` : 'Delete Task'}
          </motion.button>
        </div>
      </div>
    </ModalWrapper>
  )
}
