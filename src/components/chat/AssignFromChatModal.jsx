import { useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ExternalLink, UserPlus } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTaskActions, useProfiles } from '../../hooks/useTasks'
import { showToast } from '../ui'
import { buildPrefillUrl } from '../../lib/dmPrefillUrl'

export default function AssignFromChatModal({ conversation, onClose, onPosted }) {
  const { profile } = useAuth()
  const { profiles } = useProfiles({ excludeExternals: true })
  const { assignTask } = useTaskActions()
  const navigate = useNavigate()

  const isGroup = conversation.kind === 'group' || conversation.kind === 'hub'
  const profileById = useMemo(
    () => new Map(profiles.map(p => [p.id, p])),
    [profiles]
  )

  // Default candidate owners: DM → the other participant; Group → everyone
  // in the group except the current user.
  const defaultOwnerIds = useMemo(() => {
    if (isGroup) {
      const me = profile?.id
      const parts = conversation.participants || []
      return parts.filter(p => p.id && p.id !== me).map(p => p.id)
    }
    return conversation.other_user_id ? [conversation.other_user_id] : []
  }, [isGroup, conversation.participants, conversation.other_user_id, profile?.id])

  const [ownerIds, setOwnerIds] = useState(defaultOwnerIds)
  const [addOpen, setAddOpen] = useState(false)
  const [ownerQuery, setOwnerQuery] = useState('')
  const addRef = useRef(null)

  // Close the add-owner dropdown when clicking outside.
  useEffect(() => {
    function onDocClick(e) {
      if (!addRef.current) return
      if (!addRef.current.contains(e.target)) setAddOpen(false)
    }
    if (addOpen) document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [addOpen])

  // Teams pool = union of the first owner's teams (used as the task's team).
  const primaryOwner = ownerIds[0] ? profileById.get(ownerIds[0]) : null
  const teams = useMemo(() => {
    if (!primaryOwner) return []
    return primaryOwner.all_teams || (primaryOwner.teams
      ? [{ id: primaryOwner.team_id, name: primaryOwner.teams.name, is_primary: true }]
      : [])
  }, [primaryOwner])

  const defaultTeamId = teams.find(t => t.is_primary)?.id || teams[0]?.id || ''

  const [form, setForm] = useState({
    title: '', urgency: 'Med', dueDate: '', notes: '',
    teamId: defaultTeamId,
  })
  const [busy, setBusy] = useState(false)

  // Keep teamId in sync with primary owner changes.
  useEffect(() => {
    setForm(f => ({ ...f, teamId: defaultTeamId }))
  }, [defaultTeamId])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function addOwner(id) {
    if (!id || ownerIds.includes(id)) return
    setOwnerIds(prev => [...prev, id])
    setOwnerQuery('')
    setAddOpen(false)
  }
  function removeOwner(id) {
    setOwnerIds(prev => prev.filter(o => o !== id))
  }

  // Search candidates = all profiles except me and already-selected owners.
  const candidates = useMemo(() => {
    const q = ownerQuery.trim().toLowerCase()
    return profiles
      .filter(p => p.id !== profile?.id)
      .filter(p => !ownerIds.includes(p.id))
      .filter(p => !q || (p.full_name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [profiles, ownerIds, ownerQuery, profile?.id])

  async function submit() {
    if (!form.title.trim() || busy || ownerIds.length === 0) return
    setBusy(true)
    const result = await assignTask({
      assigneeIds: ownerIds,
      title: form.title.trim(),
      urgency: form.urgency,
      dueDate: form.dueDate || null,
      whoTo: '',
      notes: form.notes.trim(),
      icon: '',
      allProfiles: profiles,
      teamId: form.teamId,
    })
    setBusy(false)

    if (!result?.ok) {
      showToast('Failed to assign task', 'error')
      return
    }
    const titleTrim = form.title.trim()
    const taskUuid = result.task?.id
    const taskLink = taskUuid ? `[${titleTrim}](/my-tasks?task=${taskUuid})` : `**${titleTrim}**`
    const ownerNames = ownerIds
      .map(id => profileById.get(id)?.full_name)
      .filter(Boolean)
    const ownerSuffix = ownerNames.length > 0 ? ` to ${ownerNames.join(', ')}` : ''
    const sysMsg = `${profile.full_name} assigned a task${ownerSuffix}: ${taskLink}` +
      (form.dueDate ? ` (due ${form.dueDate})` : '')
    await onPosted?.(sysMsg, taskUuid)
    showToast('Task assigned', 'success')
    onClose()
  }

  function openFullForm() {
    const url = buildPrefillUrl({
      assigneeId: ownerIds[0] || '',
      teamId:     form.teamId,
      title:      form.title,
      urgency:    form.urgency,
      dueDate:    form.dueDate,
      notes:      form.notes,
    })
    navigate(url)
    onClose()
  }

  const headerLabel = isGroup
    ? (conversation.title || 'group')
    : (conversation.other_profile?.full_name || 'contact')

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-3">
      <div className="bg-white dark:bg-dark-card rounded-xl w-full max-w-sm p-4 shadow-elevated">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Assign a task in {headerLabel}
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          {/* Owner chips */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              Task owners
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {ownerIds.map(id => {
                const p = profileById.get(id)
                return (
                  <span key={id} className="flex items-center gap-1 pl-1 pr-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-200 text-xs">
                    {p?.avatar_url
                      ? <img src={p.avatar_url} className="w-4 h-4 rounded-full" alt="" />
                      : <span className="w-4 h-4 rounded-full bg-brand-500 text-white text-[9px] font-bold flex items-center justify-center">
                          {p?.full_name?.[0] || '?'}
                        </span>}
                    <span className="truncate max-w-[120px]">{p?.full_name || 'Unknown'}</span>
                    <button
                      type="button"
                      onClick={() => removeOwner(id)}
                      className="text-brand-500 hover:text-brand-700 dark:text-brand-300 dark:hover:text-brand-100"
                      aria-label={`Remove ${p?.full_name || 'owner'}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )
              })}
              <div ref={addRef} className="relative">
                <button
                  type="button"
                  onClick={() => setAddOpen(v => !v)}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-dashed border-slate-300 dark:border-slate-600 text-slate-500 hover:border-brand-400 hover:text-brand-500"
                >
                  <UserPlus className="w-3 h-3" /> Add owner
                </button>
                {addOpen && (
                  <div className="absolute left-0 top-full mt-1 z-10 w-64 rounded-lg bg-white dark:bg-dark-card border border-slate-200 dark:border-dark-border shadow-elevated p-2">
                    <input
                      autoFocus
                      placeholder="Search people…"
                      value={ownerQuery}
                      onChange={e => setOwnerQuery(e.target.value)}
                      className="w-full px-2 py-1 rounded border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
                    />
                    <div className="mt-1 max-h-44 overflow-y-auto">
                      {candidates.length === 0 && (
                        <div className="text-[11px] text-slate-400 px-2 py-1.5">No matches</div>
                      )}
                      {candidates.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => addOwner(p.id)}
                          className="w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-left"
                        >
                          {p.avatar_url
                            ? <img src={p.avatar_url} className="w-5 h-5 rounded-full" alt="" />
                            : <span className="w-5 h-5 rounded-full bg-brand-500 text-white text-[10px] font-bold flex items-center justify-center">
                                {p.full_name?.[0] || '?'}
                              </span>}
                          <span className="truncate">{p.full_name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <input
            autoFocus
            placeholder="Task title"
            value={form.title}
            onChange={e => set('title', e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={form.urgency}
              onChange={e => set('urgency', e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
            >
              <option value="Low">Low</option>
              <option value="Med">Medium</option>
              <option value="High">High</option>
            </select>
            <input
              type="date"
              value={form.dueDate}
              onChange={e => set('dueDate', e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
            />
          </div>
          {teams.length > 1 && (
            <select
              value={form.teamId}
              onChange={e => set('teamId', e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
            >
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <textarea
            placeholder="Notes (optional)"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white"
          />
        </div>

        <div className="flex items-center justify-between mt-4">
          <button
            type="button"
            onClick={openFullForm}
            className="flex items-center gap-1 text-xs text-brand-500 hover:underline"
          >
            <ExternalLink className="w-3 h-3" /> Open full form
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!form.title.trim() || busy || ownerIds.length === 0}
              onClick={submit}
              className="px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              Assign
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
