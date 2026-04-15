import { useState, useRef, useEffect } from 'react'
import { useHubTodoComments } from '../../hooks/useHubTodoComments'
import { useHubMembers } from '../../hooks/useHubMembers'
import { useAuth } from '../../hooks/useAuth'
import { SlidePanel } from '../ui/animations'
import RichInput from '../ui/RichInput'
import RichContentRenderer from '../ui/RichContentRenderer'
import { Spinner } from '../ui/index'
import { X, Trash2, Calendar, Users, Check } from 'lucide-react'

export default function TodoItemDetail({ item, hubId, onClose, onUpdate, onDelete, onToggle, onSetAssignees }) {
  const { profile } = useAuth()
  const { comments, loading: commentsLoading, addComment, deleteComment } = useHubTodoComments(item.id, hubId)
  const { members } = useHubMembers(hubId)

  const [title, setTitle] = useState(item.title)
  const [notes, setNotes] = useState(item.notes || '')
  const [dueDate, setDueDate] = useState(item.due_date || '')
  const [showAssigneePicker, setShowAssigneePicker] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [saving, setSaving] = useState(false)
  const commentSubmitRef = useRef(null)

  const assigneeIds = (item.hub_todo_item_assignees || []).map(a => (a.profiles || a.profile)?.id).filter(Boolean)

  // Sync when item changes from realtime
  useEffect(() => {
    setTitle(item.title)
    setNotes(item.notes || '')
    setDueDate(item.due_date || '')
  }, [item.id, item.title, item.notes, item.due_date])

  async function handleSaveTitle() {
    if (title.trim() && title.trim() !== item.title) {
      await onUpdate(item.id, { title: title.trim() })
    }
  }

  async function handleSaveNotes({ content, mentions, inlineImages }) {
    setSaving(true)
    await onUpdate(item.id, { notes: content, inlineImages }, mentions)
    setSaving(false)
  }

  async function handleDueDateChange(e) {
    const val = e.target.value || null
    setDueDate(val || '')
    await onUpdate(item.id, { due_date: val })
  }

  async function handleToggleAssignee(profileId) {
    const newIds = assigneeIds.includes(profileId)
      ? assigneeIds.filter(id => id !== profileId)
      : [...assigneeIds, profileId]
    await onSetAssignees(item.id, newIds)
  }

  async function handleAddComment({ content, mentions, inlineImages }) {
    if (!content.trim()) return
    await addComment(content, mentions, inlineImages)
    setCommentText('')
  }

  async function handleDelete() {
    if (!window.confirm('Delete this to-do?')) return
    await onDelete(item.id)
    onClose()
  }

  const notesSubmitRef = useRef(null)

  return (
    <SlidePanel isOpen={true} onClose={onClose} width={520}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-dark-border">
          <button
            onClick={() => onToggle(item.id, item.completed)}
            className={`w-5 h-5 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
              item.completed
                ? 'bg-green-500 border-green-500 text-white'
                : 'border-slate-300 dark:border-slate-600 hover:border-brand-500'
            }`}
          >
            {item.completed && <Check size={12} />}
          </button>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
            className={`flex-1 text-base font-semibold bg-transparent outline-none ${item.completed ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}
          />
          <button onClick={handleDelete} className="p-1.5 text-slate-400 hover:text-red-500" title="Delete to-do">
            <Trash2 size={16} />
          </button>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Completion info */}
          {item.completed && item.completer && (
            <div className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1.5">
              <Check size={12} />
              Completed by {item.completer.full_name}
              {item.completed_at && (' on ' + new Date(item.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}
            </div>
          )}

          {/* Due date */}
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-slate-400" />
            <span className="text-xs text-slate-500 dark:text-slate-400 w-16">Due date</span>
            <input
              type="date"
              value={dueDate}
              onChange={handleDueDateChange}
              className="form-input text-xs py-1 px-2"
            />
            {dueDate && (
              <button onClick={() => handleDueDateChange({ target: { value: '' } })} className="text-xs text-slate-400 hover:text-red-500">
                Clear
              </button>
            )}
          </div>

          {/* Assignees */}
          <div>
            <button
              onClick={() => setShowAssigneePicker(!showAssigneePicker)}
              className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            >
              <Users size={14} className="text-slate-400" />
              <span className="w-16">Assigned</span>
              {assigneeIds.length === 0 ? (
                <span className="text-slate-300 dark:text-slate-600">No one</span>
              ) : (
                <div className="flex -space-x-1.5">
                  {(item.hub_todo_item_assignees || []).slice(0, 5).map(a => {
                    const p = a.profiles || a.profile
                    if (!p) return null
                    return p.avatar_url ? (
                      <img key={p.id} src={p.avatar_url} className="w-5 h-5 rounded-full ring-2 ring-white dark:ring-dark-card" alt={p.full_name} title={p.full_name} />
                    ) : (
                      <div key={p.id} className="w-5 h-5 rounded-full bg-brand-500 ring-2 ring-white dark:ring-dark-card flex items-center justify-center text-white text-[9px] font-bold" title={p.full_name}>
                        {p.full_name?.[0] || '?'}
                      </div>
                    )
                  })}
                </div>
              )}
            </button>

            {showAssigneePicker && (
              <div className="mt-2 ml-6 p-2 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card max-h-48 overflow-y-auto space-y-0.5">
                {members.map(m => {
                  const p = m.profile || m
                  if (!p?.id) return null
                  const selected = assigneeIds.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      onClick={() => handleToggleAssignee(p.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm hover:bg-slate-50 dark:hover:bg-dark-hover ${selected ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`}
                    >
                      {p.avatar_url ? (
                        <img src={p.avatar_url} className="w-5 h-5 rounded-full" alt="" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center text-white text-[9px] font-bold">
                          {p.full_name?.[0] || '?'}
                        </div>
                      )}
                      <span className="flex-1 text-slate-700 dark:text-slate-300 truncate">{p.full_name}</span>
                      {selected && <Check size={14} className="text-brand-500 shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Notes</h4>
            {item.notes ? (
              <div className="mb-2">
                <RichContentRenderer content={item.notes} mentions={item.mentions || []} inlineImages={item.inline_images || []} />
              </div>
            ) : null}
            <RichInput
              value={notes}
              onChange={setNotes}
              onSubmit={handleSaveNotes}
              submitRef={notesSubmitRef}
              hubId={hubId}
              enableMentions
              enableImages
              placeholder="Add notes, @mention people..."
              rows={2}
            />
            <div className="flex justify-end mt-1.5">
              <button
                onClick={() => notesSubmitRef.current?.()}
                disabled={saving}
                className="btn btn-primary text-xs px-3 py-1 disabled:opacity-40"
              >
                {saving ? 'Saving...' : 'Save notes'}
              </button>
            </div>
          </div>

          {/* Comments */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
              Comments {comments.length > 0 && `(${comments.length})`}
            </h4>

            {commentsLoading ? (
              <div className="py-3 flex justify-center"><Spinner /></div>
            ) : (
              <div className="space-y-3">
                {comments.map(c => (
                  <div key={c.id} className="flex items-start gap-2">
                    {c.author?.avatar_url ? (
                      <img src={c.author.avatar_url} className="w-6 h-6 rounded-full mt-0.5" alt="" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-[8px] font-bold mt-0.5">
                        {c.author?.full_name?.[0] || '?'}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">{c.author?.full_name}</span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                          {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </span>
                        {c.created_by === profile?.id && (
                          <button onClick={() => deleteComment(c.id)} className="text-[10px] text-slate-300 hover:text-red-500 ml-auto">Delete</button>
                        )}
                      </div>
                      <div className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                        <RichContentRenderer content={c.content} mentions={c.mentions || []} inlineImages={c.inline_images || []} />
                      </div>
                    </div>
                  </div>
                ))}

                {/* Add comment */}
                <div className="flex items-start gap-2">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} className="w-6 h-6 rounded-full mt-0.5" alt="" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-[8px] font-bold mt-0.5">
                      {profile?.full_name?.[0] || '?'}
                    </div>
                  )}
                  <div className="flex-1">
                    <RichInput
                      value={commentText}
                      onChange={setCommentText}
                      onSubmit={handleAddComment}
                      submitRef={commentSubmitRef}
                      hubId={hubId}
                      enableMentions
                      enableImages={false}
                      placeholder="Add a comment..."
                      rows={1}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </SlidePanel>
  )
}
