import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ExternalLink, UserPlus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useHubs } from '../../hooks/useHubs'
import { useHubMembers } from '../../hooks/useHubMembers'
import { showToast } from '../ui'

/**
 * AssignTodoFromChatModal — the to-do counterpart to AssignFromChatModal.
 *
 * Used from the chat header "Add to-do" button. Creates a hub_todo_items
 * row in the chosen hub/list and assigns it to one or more members of
 * that hub. Externals (Agent/Client) see this instead of "Assign task".
 */
export default function AssignTodoFromChatModal({ conversation, onClose }) {
  const { profile } = useAuth()
  const { hubs, loading: hubsLoading } = useHubs()
  const navigate = useNavigate()

  const [hubId, setHubId] = useState('')
  const [lists, setLists] = useState([])
  const [listsLoading, setListsLoading] = useState(false)
  const [listId, setListId] = useState('')

  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const { members: hubMembers } = useHubMembers(hubId || null)

  const memberOptions = useMemo(() => {
    return (hubMembers || [])
      .filter(m => m.profile_id !== profile?.id)
      .map(m => ({ id: m.profile_id, name: m.profile?.full_name || 'Unknown' }))
  }, [hubMembers, profile?.id])

  // Default assignees: if in a DM, the other participant if they're a
  // member of the selected hub. If in a group, everyone in the group who's
  // also a member of the selected hub.
  const defaultAssigneeIds = useMemo(() => {
    if (!hubId || !hubMembers?.length) return []
    const memberIds = new Set(hubMembers.map(m => m.profile_id))
    const parts = conversation.participants || []
    const me = profile?.id
    const fromConv = (conversation.kind === 'group' || conversation.kind === 'hub')
      ? parts.filter(p => p.id && p.id !== me).map(p => p.id)
      : (conversation.other_user_id ? [conversation.other_user_id] : [])
    return fromConv.filter(id => memberIds.has(id))
  }, [hubId, hubMembers, conversation, profile?.id])

  const [assigneeIds, setAssigneeIds] = useState([])
  useEffect(() => { setAssigneeIds(defaultAssigneeIds) }, [defaultAssigneeIds])

  // Load lists when hub changes.
  useEffect(() => {
    if (!hubId) { setLists([]); setListId(''); return }
    let cancelled = false
    setListsLoading(true)
    supabase
      .from('hub_todo_lists')
      .select('id, title, color')
      .eq('hub_id', hubId)
      .is('deleted_at', null)
      .order('position')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) { showToast('Failed to load lists', 'error'); setLists([]); setListId('') }
        else {
          setLists(data || [])
          setListId(data?.[0]?.id || '')
        }
        setListsLoading(false)
      })
    return () => { cancelled = true }
  }, [hubId])

  // Auto-select first hub once hubs load.
  useEffect(() => {
    if (!hubId && hubs && hubs.length > 0) setHubId(hubs[0].id)
  }, [hubs, hubId])

  function toggleAssignee(id) {
    setAssigneeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function submit() {
    if (!title.trim() || !hubId || !listId || submitting) return
    setSubmitting(true)

    // Position: append at end of the list
    const { count } = await supabase
      .from('hub_todo_items')
      .select('*', { count: 'exact', head: true })
      .eq('list_id', listId)
      .is('deleted_at', null)

    const { data: inserted, error: insertErr } = await supabase
      .from('hub_todo_items')
      .insert({
        list_id: listId,
        hub_id: hubId,
        created_by: profile.id,
        title: title.trim(),
        due_date: dueDate || null,
        position: count || 0,
      })
      .select()
      .single()

    if (insertErr || !inserted) {
      setSubmitting(false)
      showToast('Failed to create to-do', 'error')
      return
    }

    if (assigneeIds.length > 0) {
      await supabase
        .from('hub_todo_item_assignees')
        .insert(assigneeIds.map(pid => ({ item_id: inserted.id, profile_id: pid })))
    }

    setSubmitting(false)
    showToast('To-do created')
    onClose?.()
    // Navigate straight to the item so the user can flesh it out.
    navigate(`/hub/${hubId}/todos/${listId}/items/${inserted.id}`)
  }

  const canSubmit = !!title.trim() && !!hubId && !!listId && !submitting

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/50 dark:bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-dark-border shadow-elevated w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-slate-200 dark:border-dark-border flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Add a to-do</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Title
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="form-input w-full mt-1 text-sm"
              maxLength={200}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Hub
              <select
                value={hubId}
                onChange={e => setHubId(e.target.value)}
                className="form-input w-full mt-1 text-sm"
                disabled={hubsLoading}
              >
                {(hubs || []).map(h => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
                {(!hubs || hubs.length === 0) && <option value="">No hubs available</option>}
              </select>
            </label>

            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              List
              <select
                value={listId}
                onChange={e => setListId(e.target.value)}
                className="form-input w-full mt-1 text-sm"
                disabled={listsLoading || lists.length === 0}
              >
                {lists.length === 0 && <option value="">{listsLoading ? 'Loading…' : 'No lists in this hub'}</option>}
                {lists.map(l => (
                  <option key={l.id} value={l.id}>{l.title}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
            Due date (optional)
            <input
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              className="form-input w-full mt-1 text-sm"
            />
          </label>

          <div>
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">Assign to</p>
            {memberOptions.length === 0 ? (
              <p className="text-xs text-slate-400">No other members in this hub.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {memberOptions.map(m => {
                  const selected = assigneeIds.includes(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleAssignee(m.id)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        selected
                          ? 'bg-brand-500 text-white border-brand-500'
                          : 'bg-white dark:bg-dark-surface border-slate-200 dark:border-dark-border text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-dark-hover'
                      }`}
                    >
                      {selected && <span className="mr-1">✓</span>}
                      {m.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        <footer className="px-4 py-3 border-t border-slate-200 dark:border-dark-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-dark-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={submit}
            className="btn btn-primary text-sm flex items-center gap-1.5 disabled:opacity-40"
          >
            <ExternalLink size={13} />
            {submitting ? 'Creating…' : 'Create to-do'}
          </button>
        </footer>
      </div>
    </div>
  )
}
