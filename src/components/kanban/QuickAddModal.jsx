import { useState } from 'react'
import { ModalWrapper } from '../ui/animations'
import { showToast } from '../ui'

const URGENCY_OPTIONS = ['High', 'Med', 'Low']

export default function QuickAddModal({ isOpen, onClose, status, profile, profiles, assignTask, updateTask, refetch }) {
  const [title, setTitle] = useState('')
  const [assigneeId, setAssigneeId] = useState(profile?.id || '')
  const [urgency, setUrgency] = useState('Med')
  const [dueDate, setDueDate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const today = new Date().toISOString().split('T')[0]

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) { showToast('Title is required', 'error'); return }

    setSubmitting(true)

    const result = await assignTask({
      assigneeIds: [assigneeId || profile?.id],
      title: title.trim(),
      urgency,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      allProfiles: profiles,
      teamId: profile?.team_id,
    })

    if (!result.ok) {
      showToast(result.msg || 'Failed to create task', 'error')
      setSubmitting(false)
      return
    }

    // If column isn't "Not Started", update status
    if (status !== 'Not Started' && result.task?.id) {
      await updateTask(result.task.id, { status })
    }

    showToast(`Task added to ${status}`)
    refetch()
    setSubmitting(false)

    // Reset and close
    setTitle('')
    setAssigneeId(profile?.id || '')
    setUrgency('Med')
    setDueDate('')
    onClose()
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="p-5">
          <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">Quick Add Task</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Adding to <span className="font-semibold">{status}</span>
          </p>

          {/* Title */}
          <div className="mb-3">
            <input
              type="text"
              placeholder="Task title..."
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="form-input w-full"
              autoFocus
            />
          </div>

          {/* Assignee */}
          <div className="mb-3">
            <label className="form-label text-xs mb-1 block">Assignee</label>
            <select
              value={assigneeId}
              onChange={e => setAssigneeId(e.target.value)}
              className="form-input w-full"
            >
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.full_name}{p.id === profile?.id ? ' (me)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Urgency toggle */}
          <div className="mb-3">
            <label className="form-label text-xs mb-1 block">Urgency</label>
            <div className="inline-flex rounded-lg bg-slate-100 dark:bg-dark-hover p-0.5 gap-0.5">
              {URGENCY_OPTIONS.map(u => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUrgency(u)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-150 ${
                    urgency === u
                      ? 'bg-white dark:bg-dark-card text-slate-900 dark:text-white shadow-soft'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          {/* Due date */}
          <div className="mb-1">
            <label className="form-label text-xs mb-1 block">Due date (optional)</label>
            <input
              type="date"
              min={today}
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="form-input w-full"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 dark:border-dark-border">
          <button type="button" onClick={onClose} className="btn-ghost text-sm px-4 py-2">
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-primary text-sm px-4 py-2">
            {submitting ? 'Adding...' : 'Add Task'}
          </button>
        </div>
      </form>
    </ModalWrapper>
  )
}
