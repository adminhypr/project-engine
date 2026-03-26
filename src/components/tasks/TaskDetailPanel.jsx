import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { X, Send, Check, RefreshCw, Pencil, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useTaskActions, useProfiles } from '../../hooks/useTasks'
import { useAuth } from '../../hooks/useAuth'
import { formatDate } from '../../lib/helpers'
import { AssignmentBadge, UrgencyBadge, StatusBadge, PriorityBadge, showToast } from '../ui'
import { SlidePanel, SuccessBurst, ShakeReject } from '../ui/animations'
import ActivityLog from './ActivityLog'
import DeclineModal from './DeclineModal'
import ReassignModal from './ReassignModal'
import DeleteConfirmModal from './DeleteConfirmModal'

export default function TaskDetailPanel({ task, onClose, onUpdated }) {
  const { profile, isAdmin, isManager } = useAuth()
  const { updateTask, addComment, getTaskComments, acceptTask, declineTask, reassignTask, deleteTask } = useTaskActions()
  const { profiles: allProfiles } = useProfiles()

  const [status,   setStatus]   = useState(task?.status || 'Not Started')
  const [notes,    setNotes]    = useState(task?.notes || '')
  const [comments, setComments] = useState([])
  const [newComment, setNewComment] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [posting,  setPosting]  = useState(false)
  const [loadingComments, setLoadingComments] = useState(true)
  const [mentionedIds, setMentionedIds] = useState([])
  const [mentionQuery, setMentionQuery] = useState(null) // null = picker closed, '' = open no filter
  const [mentionIndex, setMentionIndex] = useState(0)
  const commentRef = useRef(null)
  const [showDeclineModal, setShowDeclineModal] = useState(false)
  const [showReassignModal, setShowReassignModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [acceptAnim, setAcceptAnim] = useState(0)
  const [declineAnim, setDeclineAnim] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editUrgency, setEditUrgency] = useState('')
  const [editDueDate, setEditDueDate] = useState('')
  const [editWhoTo, setEditWhoTo] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const canEdit = isAdmin ||
    (task?.team_id && profile?.team_roles?.[task.team_id] === 'Manager') ||
    task?.assigned_to === profile?.id ||
    task?.assigned_by === profile?.id
  const isOwner = task?.assigned_by === profile?.id || isAdmin

  const isPending = task?.acceptance_status === 'Pending'
  const isDeclined = task?.acceptance_status === 'Declined'
  const isMyTask = task?.assigned_to === profile?.id
  const canAcceptDecline = isPending && isMyTask
  const canReassign = isDeclined && (task?.assigned_by === profile?.id || isAdmin)

  useEffect(() => {
    if (!task) return
    setStatus(task.status || 'Not Started')
    setNotes(task.notes || '')
    setEditing(false)
    setEditTitle(task.title || '')
    setEditUrgency(task.urgency || 'Med')
    setEditDueDate(task.due_date ? new Date(task.due_date).toISOString().slice(0, 16) : '')
    setEditWhoTo(task.who_due_to || '')
    setLoadingComments(true)
    getTaskComments(task.id).then(data => {
      setComments(data)
      setLoadingComments(false)
    })
  }, [task?.id])

  function startEditing() {
    setEditTitle(task.title || '')
    setEditUrgency(task.urgency || 'Med')
    setEditDueDate(task.due_date ? new Date(task.due_date).toISOString().slice(0, 16) : '')
    setEditWhoTo(task.who_due_to || '')
    setEditing(true)
  }

  async function handleSaveEdit() {
    setSavingEdit(true)
    const updates = {
      title: editTitle.trim(),
      urgency: editUrgency,
      due_date: editDueDate || null,
      who_due_to: editWhoTo.trim() || null,
    }
    const result = await updateTask(task.id, updates)
    setSavingEdit(false)
    if (result.ok) {
      showToast('Task details updated')
      setEditing(false)
      onUpdated?.()
    } else {
      showToast(result.msg, 'error')
    }
  }

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

  async function handleDelete() {
    const result = await deleteTask(task.id)
    if (result.ok) {
      showToast('Task deleted')
      onClose()
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

  // Mention picker logic
  const mentionResults = mentionQuery !== null
    ? allProfiles
        .filter(p => p.id !== profile?.id && p.full_name?.toLowerCase().includes(mentionQuery.toLowerCase()))
        .slice(0, 6)
    : []

  function handleCommentChange(e) {
    const val = e.target.value
    setNewComment(val)

    // Detect @ trigger: find the last @ before cursor
    const cursor = e.target.selectionStart
    const textBefore = val.slice(0, cursor)
    const atMatch = textBefore.match(/@(\w*)$/)
    if (atMatch) {
      setMentionQuery(atMatch[1])
      setMentionIndex(0)
    } else {
      setMentionQuery(null)
    }
  }

  function insertMention(p) {
    const textarea = commentRef.current
    const cursor = textarea.selectionStart
    const textBefore = newComment.slice(0, cursor)
    const textAfter = newComment.slice(cursor)
    // Replace the @query with @Name
    const replaced = textBefore.replace(/@\w*$/, `@${p.full_name} `)
    setNewComment(replaced + textAfter)
    setMentionedIds(prev => prev.includes(p.id) ? prev : [...prev, p.id])
    setMentionQuery(null)
    // Refocus
    setTimeout(() => {
      textarea.focus()
      const pos = replaced.length
      textarea.setSelectionRange(pos, pos)
    }, 0)
  }

  function handleCommentKeyDown(e) {
    if (mentionQuery !== null && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(i => Math.min(i + 1, mentionResults.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(mentionResults[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        setMentionQuery(null)
        return
      }
    }
    if (e.key === 'Enter' && e.metaKey) handlePostComment()
  }

  async function handlePostComment() {
    if (!newComment.trim() || !task) return
    const text = newComment.trim()
    setPosting(true)
    const result = await addComment(task.id, text)
    setPosting(false)
    if (result.ok) {
      setComments(prev => [result.comment, ...prev])
      setNewComment('')
      setMentionedIds([])
      setMentionQuery(null)

      // Notify assignee, assigner, and @mentioned people (non-blocking)
      supabase.functions.invoke('user-notify', {
        body: { type: 'comment', taskId: task.id, authorId: profile.id, commentText: text, mentionedIds }
      }).then(({ error }) => {
        if (error) console.warn('Comment notification email failed:', error)
      }).catch(err => console.warn('Comment notification email failed:', err))
    } else {
      showToast(result.msg, 'error')
    }
  }

  if (!task) return null

  return (
    <SlidePanel isOpen={!!task} onClose={onClose}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-100 dark:border-dark-border flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isPending && <span className="badge bg-yellow-500/15 text-yellow-700 text-[10px]">Pending</span>}
            {isDeclined && <span className="badge bg-red-500/15 text-red-700 text-[10px]">Declined</span>}
          </div>
          {editing ? (
            <input
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              className="form-input font-semibold text-slate-900 dark:text-white w-full"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-slate-900 dark:text-white leading-snug">{task.title}</h3>
              {isOwner && !editing && (
                <button
                  onClick={startEditing}
                  className="text-slate-300 hover:text-brand-500 dark:text-slate-600 dark:hover:text-brand-400 transition-colors"
                  title="Edit task"
                >
                  <Pencil size={14} />
                </button>
              )}
            </div>
          )}
        </div>
        {canEdit && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 p-1.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10 transition-all duration-200 flex-shrink-0"
            title="Delete task"
          >
            <Trash2 size={18} />
          </button>
        )}
        <button
          onClick={onClose}
          className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-dark-hover transition-all duration-200 flex-shrink-0"
        >
          <X size={20} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">

        {/* Acceptance actions */}
        {canAcceptDecline && (
          <div className="px-5 py-4 border-b border-slate-100 dark:border-dark-border bg-yellow-500/5">
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
          <div className="px-5 py-4 border-b border-slate-100 dark:border-dark-border bg-red-500/5">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wider mb-2">Task Declined</p>
            {task.decline_reason && (
              <p className="text-sm text-slate-700 dark:text-slate-200 mb-2 italic">"{task.decline_reason}"</p>
            )}
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
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

        {/* Edit save/cancel bar */}
        {editing && (
          <div className="px-5 py-3 border-b border-slate-100 dark:border-dark-border bg-brand-50 dark:bg-brand-500/5 flex items-center gap-2">
            <button onClick={handleSaveEdit} disabled={savingEdit} className="btn-primary text-xs px-4 py-1.5">
              {savingEdit ? 'Saving...' : 'Save Changes'}
            </button>
            <button onClick={() => setEditing(false)} className="btn-ghost text-xs px-3 py-1.5">Cancel</button>
          </div>
        )}

        {/* Meta grid */}
        <div className="px-4 sm:px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-3 border-b border-slate-100 dark:border-dark-border">
          {[
            { label: 'Assigned To',   value: task.assignee?.full_name },
            { label: 'Assigned By',   value: task.assigner?.full_name },
            { label: 'Date Assigned', value: formatDate(task.date_assigned) },
            { label: 'Due Date',      value: editing
              ? <input type="datetime-local" value={editDueDate} onChange={e => setEditDueDate(e.target.value)} className="form-input text-sm py-1" />
              : task.due_date ? formatDate(task.due_date) : '—'
            },
            { label: 'Team',          value: task.team?.name },
            { label: 'Reports To',   value: task.assignee?.manager?.full_name || '—' },
            { label: 'For',           value: editing
              ? <input value={editWhoTo} onChange={e => setEditWhoTo(e.target.value)} className="form-input text-sm py-1" placeholder="Who it's for..." />
              : task.who_due_to || '—'
            },
            { label: 'Last Updated',  value: formatDate(task.last_updated) },
            { label: 'Priority',      value: <PriorityBadge priority={task.priority} /> },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
              <div className="text-sm text-slate-800 dark:text-slate-200">{value}</div>
            </div>
          ))}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Urgency</p>
            {editing
              ? <select value={editUrgency} onChange={e => setEditUrgency(e.target.value)} className="form-input text-sm py-1">
                  <option>High</option>
                  <option>Med</option>
                  <option>Low</option>
                </select>
              : <UrgencyBadge urgency={task.urgency} />
            }
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Assignment Type</p>
            <AssignmentBadge type={task.assignment_type} />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Acceptance</p>
            {task.acceptance_status === 'Accepted' && task.assignment_type === 'Superior' ? (
              <span className="text-xs text-slate-400 dark:text-slate-500">Auto-accepted — Superior assigned</span>
            ) : task.acceptance_status === 'Accepted' && task.assignment_type === 'Self' ? (
              <span className="text-xs text-slate-400 dark:text-slate-500">Auto-accepted — Self assigned</span>
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
          <div className="px-5 py-4 border-b border-slate-100 dark:border-dark-border bg-slate-50 dark:bg-dark-bg">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Update Task</p>
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
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
            Comments ({comments.length})
          </p>

          <div className="flex gap-2 items-end mb-4 relative">
            <div className="flex-1 relative">
              <textarea
                ref={commentRef}
                value={newComment}
                onChange={handleCommentChange}
                placeholder="Write a comment... Use @ to mention someone"
                rows={2}
                className="form-input flex-1 w-full resize-none"
                onKeyDown={handleCommentKeyDown}
              />
              {/* @mention dropdown */}
              {mentionQuery !== null && mentionResults.length > 0 && (
                <div className="absolute bottom-full left-0 mb-1 w-full bg-white dark:bg-dark-card rounded-xl shadow-elevated border border-slate-200 dark:border-dark-border z-50 overflow-hidden max-h-48 overflow-y-auto">
                  {mentionResults.map((p, i) => (
                    <button
                      key={p.id}
                      className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors ${
                        i === mentionIndex
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                          : 'hover:bg-slate-50 dark:hover:bg-dark-hover text-slate-700 dark:text-slate-200'
                      }`}
                      onMouseDown={e => { e.preventDefault(); insertMention(p) }}
                    >
                      {p.avatar_url
                        ? <img src={p.avatar_url} className="w-5 h-5 rounded-full" alt="" />
                        : <div className="w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center text-white text-[10px] font-bold">
                            {p.full_name?.[0] || '?'}
                          </div>
                      }
                      <span className="font-medium">{p.full_name}</span>
                      <span className="text-xs text-slate-400 dark:text-slate-500">{p.role}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={handlePostComment}
              disabled={posting || !newComment.trim()}
              className="btn-primary h-[60px] px-4"
            >
              <Send size={16} />
            </button>
          </div>

          {loadingComments ? (
            <p className="text-sm text-slate-400 text-center py-4">Loading comments...</p>
          ) : comments.length === 0 ? (
            <p className="text-sm text-slate-400 italic">No comments yet.</p>
          ) : (
            <div className="space-y-3">
              {comments.map(c => (
                <div key={c.id} className="bg-slate-50 dark:bg-dark-bg rounded-xl p-3 border border-slate-100 dark:border-dark-border">
                  <div className="flex items-center gap-2 mb-1.5">
                    {c.author?.avatar_url
                      ? <img src={c.author.avatar_url} className="w-5 h-5 rounded-full" alt="" />
                      : <div className="w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center text-white text-[10px] font-bold">
                          {c.author?.full_name?.[0] || '?'}
                        </div>
                    }
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{c.author?.full_name}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{formatDate(c.created_at)}</span>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                    {c.content.split(/(@\w[\w\s]*?\w)(?=\s|$|[.,!?])/).map((part, i) =>
                      part.startsWith('@')
                        ? <span key={i} className="text-brand-600 dark:text-brand-400 font-semibold">{part}</span>
                        : part
                    )}
                  </p>
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
      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        taskTitle={task.title}
      />
    </SlidePanel>
  )
}
