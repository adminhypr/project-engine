import { useState } from 'react'
import { motion } from 'framer-motion'
import { ModalWrapper } from '../ui/animations'
import { useProfiles } from '../../hooks/useTasks'

export default function ReassignModal({ isOpen, onClose, onConfirm, task }) {
  const { profiles } = useProfiles()
  const [assigneeId, setAssigneeId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleConfirm() {
    if (!assigneeId) return
    setSubmitting(true)
    await onConfirm(assigneeId)
    setSubmitting(false)
    setAssigneeId('')
    onClose()
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose}>
      <div className="p-6">
        <h3 className="text-lg font-semibold text-navy-900 mb-1">Reassign Task</h3>
        <p className="text-sm text-navy-500 mb-4">
          Choose a new person to assign this task to. They will need to accept it.
        </p>

        <div className="mb-4">
          <label className="form-label">Assign To</label>
          <select
            value={assigneeId}
            onChange={e => setAssigneeId(e.target.value)}
            className="form-input"
          >
            <option value="">— Select person —</option>
            {profiles
              .filter(p => p.id !== task?.assigned_to)
              .map(p => (
                <option key={p.id} value={p.id}>
                  {p.full_name} ({p.teams?.name || 'No team'})
                </option>
              ))}
          </select>
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
            className="btn-primary"
            onClick={handleConfirm}
            disabled={submitting || !assigneeId}
            whileTap={{ scale: 0.97 }}
          >
            {submitting ? 'Reassigning...' : 'Reassign'}
          </motion.button>
        </div>
      </div>
    </ModalWrapper>
  )
}
