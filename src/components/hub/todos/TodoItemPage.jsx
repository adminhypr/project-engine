import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useHubTodoComments } from '../../../hooks/useHubTodoComments'
import { useHubMembers } from '../../../hooks/useHubMembers'
import { useAuth } from '../../../hooks/useAuth'
import TodoEditor from './TodoEditor'
import RichContentRenderer from '../../ui/RichContentRenderer'
import RichTextField from './RichTextField'
import TodoBreadcrumb from './TodoBreadcrumb'
import TodoSubscribers from './TodoSubscribers'
import TrashedToast from './TrashedToast'
import { Spinner } from '../../ui/index'
import { Trash2, Calendar, Users, Check } from 'lucide-react'

export default function TodoItemPage({ hubId, hub, lists, items, updateItem, deleteItem, undoDeleteItem, toggleItem, setAssignees }) {
  const { listId, itemId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { members } = useHubMembers(hubId)
  const { comments, loading: commentsLoading, addComment, deleteComment } = useHubTodoComments(itemId, hubId)

  const list = lists.find(l => l.id === listId)
  const item = items.find(i => i.id === itemId)

  const [title, setTitle] = useState(item?.title || '')
  const [notes, setNotes] = useState(item?.notes || '')
  const [attachments, setAttachments] = useState(item?.attachments || [])
  const [dueDate, setDueDate] = useState(item?.due_date || '')
  const [showAssignees, setShowAssignees] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [saving, setSaving] = useState(false)
  const [trashed, setTrashed] = useState(false)

  const notesSubmitRef = useRef(null)
  const commentSubmitRef = useRef(null)

  useEffect(() => {
    if (!item) return
    setTitle(item.title)
    setNotes(item.notes || '')
    setAttachments(item.attachments || [])
    setDueDate(item.due_date || '')
  }, [item?.id, item?.title, item?.notes, item?.attachments, item?.due_date])

  if (!item || !list) {
    return <div className="text-center py-12 text-sm text-slate-500">To-do not found.</div>
  }

  const assigneeIds = (item.hub_todo_item_assignees || []).map(a => (a.profiles || a.profile)?.id).filter(Boolean)

  async function handleSaveTitle() {
    if (title.trim() && title.trim() !== item.title) {
      await updateItem(item.id, { title: title.trim() })
    }
  }
  async function handleSaveNotes({ content, mentions }) {
    setSaving(true)
    await updateItem(item.id, { notes: content, attachments }, mentions)
    setSaving(false)
  }
  async function handleDueChange(e) {
    const val = e.target.value || null
    setDueDate(val || '')
    await updateItem(item.id, { due_date: val })
  }
  async function handleToggleAssignee(pid) {
    const next = assigneeIds.includes(pid) ? assigneeIds.filter(x => x !== pid) : [...assigneeIds, pid]
    await setAssignees(item.id, next)
  }
  async function handleAddComment({ html, mentions, inlineImages }) {
    const stripped = (html || '').replace(/<[^>]+>/g, '').trim()
    if (!stripped) return
    await addComment(html, mentions, inlineImages)
    setCommentText('')
  }
  async function handleDelete() {
    if (!window.confirm('Delete this to-do?')) return
    await deleteItem(item.id)
    setTrashed(true)
    setTimeout(() => navigate(`/hub/${hubId}/todos/${listId}`), 250)
  }

  return (
    <div>
      <TodoBreadcrumb segments={[
        { label: hub?.name || 'Hub', to: `/hub/${hubId}` },
        { label: 'To-dos',            to: `/hub/${hubId}/todos` },
        { label: list.title,          to: `/hub/${hubId}/todos/${listId}` },
        { label: item.title || 'Item' },
      ]} />

      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => toggleItem(item.id, item.completed)}
          className={`w-6 h-6 rounded border-2 shrink-0 flex items-center justify-center ${
            item.completed
              ? 'bg-green-500 border-green-500 text-white'
              : 'border-slate-300 dark:border-slate-600 hover:border-brand-500'
          }`}
        >
          {item.completed && <Check size={14} />}
        </button>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={handleSaveTitle}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
          className={`flex-1 text-xl font-bold bg-transparent outline-none ${item.completed ? 'line-through text-slate-400' : 'text-slate-900 dark:text-white'}`}
        />
        <button onClick={handleDelete} className="p-1.5 text-slate-400 hover:text-red-500" title="Delete">
          <Trash2 size={16} />
        </button>
      </div>

      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-3 text-xs mb-6">
        <div className="flex items-center gap-2 text-slate-500"><Users size={13} /><span>Assigned</span></div>
        <div>
          <button onClick={() => setShowAssignees(v => !v)} className="hover:text-brand-600 dark:hover:text-brand-400 text-slate-700 dark:text-slate-300">
            {assigneeIds.length === 0 ? <span className="text-slate-400">No one</span>
              : assigneeIds.length === 1 ? members.find(m => (m.profile || m).id === assigneeIds[0])?.profile?.full_name
              : `${assigneeIds.length} people`}
          </button>
          {showAssignees && (
            <div className="mt-2 rounded-lg border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card p-1 max-h-40 overflow-y-auto space-y-0.5">
              {members.map(m => {
                const p = m.profile || m
                if (!p?.id) return null
                const selected = assigneeIds.includes(p.id)
                return (
                  <button key={p.id} onClick={() => handleToggleAssignee(p.id)} className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left ${selected ? 'bg-brand-50 dark:bg-brand-500/10' : ''}`}>
                    <span className="flex-1 truncate">{p.full_name}</span>
                    {selected && <Check size={12} className="text-brand-500" />}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-slate-500"><Calendar size={13} /><span>Due on</span></div>
        <input type="date" value={dueDate} onChange={handleDueChange} className="form-input text-xs py-1 px-2 w-40" />
      </div>

      <div className="mb-6">
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Notes</h4>
        {item.notes && (
          <div className="mb-2 text-sm text-slate-700 dark:text-slate-300">
            <RichContentRenderer
              content={item.notes}
              mentions={item.mentions || []}
              inlineImages={item.inline_images || []}
              attachments={item.attachments || []}
              attachmentBucket="hub-todo-attachments"
            />
          </div>
        )}
        <RichTextField
          value={notes}
          onChange={setNotes}
          onSubmit={handleSaveNotes}
          submitRef={notesSubmitRef}
          hubId={hubId}
          placeholder="Add notes, @mention people…"
          rows={2}
          attachments={attachments}
          onAttachmentsChange={setAttachments}
        />
        <div className="flex justify-end mt-2">
          <button onClick={() => notesSubmitRef.current?.()} disabled={saving} className="btn btn-primary text-xs px-3 py-1 disabled:opacity-40">
            {saving ? 'Saving…' : 'Save notes'}
          </button>
        </div>
      </div>

      <div className="mb-6">
        <h4 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">
          Comments {comments.length > 0 && `(${comments.length})`}
        </h4>
        {commentsLoading ? <Spinner /> : (
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
                    <span className="text-[10px] text-slate-400">
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

            <div className="flex items-start gap-2">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} className="w-6 h-6 rounded-full mt-0.5" alt="" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-brand-500 flex items-center justify-center text-white text-[8px] font-bold mt-0.5">
                  {profile?.full_name?.[0] || '?'}
                </div>
              )}
              <div className="flex-1">
                <TodoEditor
                  value={commentText}
                  onChange={setCommentText}
                  onSubmit={handleAddComment}
                  submitRef={commentSubmitRef}
                  hubId={hubId}
                  placeholder="Add a comment here…"
                  minRows={1}
                  enableSubmitOnEnter
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <TodoSubscribers itemId={item.id} hubId={hubId} />

      {trashed && (
        <TrashedToast
          message="The to-do is in the trash."
          onUndo={() => { undoDeleteItem(item.id); setTrashed(false) }}
          onDismiss={() => setTrashed(false)}
        />
      )}
    </div>
  )
}
