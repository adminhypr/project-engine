import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, Send, Check, RefreshCw } from 'lucide-react'
import { useTaskActions } from '../../hooks/useTasks'
import { useAuth } from '../../hooks/useAuth'
import { formatDate } from '../../lib/helpers'
import { AssignmentBadge, UrgencyBadge, StatusBadge, PriorityBadge, showToast } from '../ui'
import { SlidePanel, SuccessBurst, ShakeReject } from '../ui/animations'
import ActivityLog from './ActivityLog'
import DeclineModal from './DeclineModal'
import ReassignModal from './ReassignModal'

export default function TaskDetailPanel({ task, onClose, onUpdated }) {
  const { profile, isAdmin, isManager } = useAuth()
  const { updateTask, addComment, getTaskComments, acceptTask, declineTask, reassignTask } = useTaskActions()

  const [status,   setStatus]   = useState(task?.status || 'Not Started')
  const [notes,    setNotes]    = useState(task?.notes || '')
  const [comments, setComments] = useState([])
  const [newComment, setNewComment] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [posting,  setPosting]  = useState(false)
  const [loadingComments, setLoadingComments] = useState(true)
  const [showDeclineModal, setShowDeclineModal] = useState(false)
  const [showReassignModal, setShowReassignModal] = useState(false)
  const [acceptAnim, setAcceptAnim] = useState(0)
  const [declineAnim, setDeclineAnim] = useState(0)

  const canEdit = isAdmin || isManager ||
    task?.assigned_to === profile?.id ||
    task?.assigned_by === profile?.id

  const isPending = task?.acceptance_status === 'Pending'
  const isDeclined = task?.acceptance_status === 'Declined'
  const isMyTask = task?.assigned_to === profile?.id
  const canAcceptDecline = isPending && isMyTask
  const canReassign = isDeclined && (task?.assigned_by === profile?.id || isAdmin)

  useEffect(() => {
    if (!task) return
    setStatus(task.status || 'Not Started')
    setNotes(task.notes || '')
    setLoadingComments(true)
    getTaskComments(task.id).then(data => {
      setComments(data)
      setLoadingComments(false)
    })
  }, [task?.id])

  async function handleSave() {
    if (!task) return
    setSaving(true)
    const result = await updateTask(task.id, { status, notes })
    setSaving(false)
    if (result.ok) {
      showToast('Task updated')
      onUpdated?.()
    } else {
      showToast(result.msg, 'error')
    }
  }

  async function handleAccept() {
    const result = await acceptTask(task.id)
    if (result.ok) {
      setAcceptAnim(prev => prev + 1)
      showToast('Task accepted')
      onUpdated?.()
    } else {
      showToast(result.msg, 'error')
    }
  }

  async function handleDecline(reason) {
    const result = await declineTask(task.id, reason)
    if (result.ok) {
      setDeclineAnim(prev => prev + 1)
      showToast('Task declined')
      onUpdated?.()
    } else {
      showToast(result.msg, 'error')
    }
  }

  async function handleReassign(newAssigneeId) {
    const result = await reassignTask(task.id, newAssigneeId)
    if (result.ok) {
      showToast('Task reassigned')
      onUpdated?.()
    } else {
      showToast(result.msg, 'error')
    }
  }

  async function handlePostComment() {
    if (!newComment.trim() || !task) return
    setPosting(true)
    const result = await addComment(task.id, newComment.trim())
    setPosting(false)
    if (result.ok) {
      setComments(prev => [result.comment, ...prev])
      setNewComment('')
    } else {
      showToast(result.msg, 'error')
    }
  }

  if (!task) return null

  return (
    <SlidePanel isOpen={!!task} onClose={onClose}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-navy-100/30 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs text-navy-400 font-mono">{task.task_id}</p>
            {isPending && <span className="badge bg-yellow-500/15 text-yellow-700 text-[10px]">Pending</span>}
            {isDeclined && <span className="badge bg-red-500/15 text-red-700 text-[10px]">Declined</span>}
          </div>
          <h3 className="font-semibold text-navy-900 leading-snug">{task.title}</h3>
        </div>
        <button
          onClick={onClose}
          className="text-navy-400 hover:text-navy-700 p-1.5 rounded-xl hover:bg-navy-100/50 transition-all duration-200 flex-shrink-0"
        >
          <X size={20} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">

        {/* Acceptance actions */}
        {canAcceptDecline && (
          <div className="px-5 py-4 border-b border-navy-100/20 bg-yellow-500/5">
            <p className="text-xs font-semibold text-yellow-700 uppercase tracking-wider mb-3">This task requires your acceptance</p>
            <div className="flex gap-2">
              <SuccessBurst trigger={acceptAnim}>
                <motion.button
                  onClick={handleAccept}
                  className="btn-primary bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20"
                  whileTap={{ scale: 0.97 }}
                >
                  <Check size={16} /> Accept
                </motion.button>
              </SuccessBurst>
              <ShakeReject trigger={declineAnim}>
                <motion.button
                  onClick={() => setShowDeclineModal(true)}
                  className="btn-danger"
                  whileTap={{ scale: 0.97 }}
                >
                  <X size={16} /> Decline
                </motion.button>
              </ShakeReject>
            </div>
          </div>
        )}

        {/* Declined info + reassign */}
        {isDeclined && (
          <div className="px-5 py-4 border-b border-navy-100/20 bg-red-500/5">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wider mb-2">Task Declined</p>
            {task.decline_reason && (
              <p className="text-sm text-navy-700 mb-2 italic">"{task.decline_reason}"</p>
            )}
            <p className="text-xs text-navy-500 mb-3">
              Declined by {task.assignee?.full_name}
              {task.declined_at && <> on {formatDate(task.declined_at)}</>}
            </p>
            {canReassign && (
              <motion.button
                onClick={() => setShowReassignModal(true)}
                className="btn-primary"
                whileTap={{ scale: 0.97 }}
              >
                <RefreshCw size={14} /> Reassign Task
              </motion.button>
            )}
          </div>
        )}

        {/* Meta grid */}
        <div className="px-5 py-4 grid grid-cols-2 gap-3 border-b border-navy-100/20">
          {[
            { label: 'Assigned To',   value: task.assignee?.full_name },
            { label: 'Assigned By',   value: task.assigner?.full_name },
            { label: 'Date Assigned', value: formatDate(task.date_assigned) },
            { label: 'Due Date',      value: task.due_date ? formatDate(task.due_date) : '—' },
            { label: 'Team',          value: task.team?.name },
            { label: 'For',           value: task.who_due_to || '—' },
            { label: 'Last Updated',  value: formatDate(task.last_updated) },
            { label: 'Priority',      value: <PriorityBadge priority={task.priority} /> },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-1">{label}</p>
              <div className="text-sm text-navy-800">{value}</div>
            </div>
          ))}
          <div>
            <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-1">Urgency</p>
            <UrgencyBadge urgency={task.urgency} />
          </div>
          <div>
            <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-1">Assignment Type</p>
            <AssignmentBadge type={task.assignment_type} />
          </div>
          <div>
            <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-1">Acceptance</p>
            {task.acceptance_status === 'Accepted' && task.assignment_type === 'Superior' ? (
              <span className="text-xs text-navy-400">Auto-accepted — Superior assigned</span>
            ) : task.acceptance_status === 'Accepted' && task.assignment_type === 'Self' ? (
              <span className="text-xs text-navy-400">Auto-accepted — Self assigned</span>
            ) : (
              <span className={`badge ${
                task.acceptance_status === 'Accepted' ? 'bg-emerald-500/15 text-emerald-700' :
                task.acceptance_status === 'Pending' ? 'bg-yellow-500/15 text-yellow-700' :
                'bg-red-500/15 text-red-700'
              }`}>
                {task.acceptance_status}
              </span>
            )}
          </div>
        </div>

        {/* Status + notes update */}
        {canEdit && task.acceptance_status !== 'Declined' && (
          <div className="px-5 py-4 border-b border-navy-100/20 bg-navy-50/30">
            <p className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-3">Update Task</p>
            <div className="flex gap-2 items-center mb-3">
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="form-input flex-1"
              >
                <option>Not Started</option>
                <option>In Progress</option>
                <option>Blocked</option>
                <option>Done</option>
              </select>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary whitespace-nowrap"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add or update notes..."
              rows={3}
              className="form-input resize-none"
            />
          </div>
        )}

        {/* Comments */}
        <div className="px-5 py-4">
          <p className="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-3">
            Comments ({comments.length})
          </p>

          <div className="flex gap-2 items-end mb-4">
            <textarea
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              placeholder="Write a comment..."
              rows={2}
              className="form-input flex-1 resize-none"
              onKeyDown={e => {
                if (e.key === 'Enter' && e.metaKey) handlePostComment()
              }}
            />
            <button
              onClick={handlePostComment}
              disabled={posting || !newComment.trim()}
              className="btn-primary h-[60px] px-3"
            >
              <Send size={16} />
            </button>
          </div>

          {loadingComments ? (
            <p className="text-sm text-navy-400 text-center py-4">Loading comments...</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-navy-400 italic">No comments yet.</p>
          ) : (
            <div className="space-y-3">
              {comments.map(c => (
                <div key={c.id} className="bg-navy-50/50 backdrop-blur-sm rounded-xl p-3 border border-navy-100/20">
                  <div className="flex items-center gap-2 mb-1.5">
                    {c.author?.avatar_url
                      ? <img src={c.author.avatar_url} className="w-5 h-5 rounded-full" alt="" />
                      : <div className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center text-white text-[10px] font-bold">
                          {c.author?.full_name?.[0] || '?'}
                        </div>
                    }
                    <span className="text-xs font-semibold text-navy-700">{c.author?.full_name}</span>
                    <span className="text-xs text-navy-400">{formatDate(c.created_at)}</span>
                  </div>
                  <p className="text-sm text-navy-700 leading-relaxed">{c.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Activity Log */}
        <ActivityLog taskId={task.id} />
      </div>

      {/* Modals */}
      <DeclineModal
        isOpen={showDeclineModal}
        onClose={() => setShowDeclineModal(false)}
        onConfirm={handleDecline}
        taskTitle={task.title}
      />
      <ReassignModal
        isOpen={showReassignModal}
        onClose={() => setShowReassignModal(false)}
        onConfirm={handleReassign}
        task={task}
      />
    </SlidePanel>
  )
}
