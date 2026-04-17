import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { X, ExternalLink } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useTaskActions, useProfiles } from '../../hooks/useTasks'
import { showToast } from '../ui'
import { buildPrefillUrl } from '../../lib/dmPrefillUrl'

export default function AssignFromChatModal({ conversation, onClose, onPosted }) {
  const { profile } = useAuth()
  const { profiles } = useProfiles()
  const { assignTask } = useTaskActions()
  const navigate = useNavigate()

  const otherProfile = conversation.other_profile
  const otherId = conversation.other_user_id

  const teams = useMemo(() => {
    const assignee = profiles.find(p => p.id === otherId)
    if (!assignee) return []
    return assignee.all_teams || (assignee.teams
      ? [{ id: assignee.team_id, name: assignee.teams.name, is_primary: true }]
      : [])
  }, [profiles, otherId])

  const defaultTeamId = teams.find(t => t.is_primary)?.id || teams[0]?.id || ''

  const [form, setForm] = useState({
    title: '', urgency: 'Med', dueDate: '', notes: '',
    teamId: defaultTeamId,
  })
  const [busy, setBusy] = useState(false)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function submit() {
    if (!form.title.trim() || busy) return
    setBusy(true)
    const result = await assignTask({
      assigneeIds: [otherId],
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
    const sysMsg = `${profile.full_name} assigned a task: **${form.title.trim()}**` +
      (form.dueDate ? ` (due ${form.dueDate})` : '')
    await onPosted?.(sysMsg, result.taskId)
    showToast('Task assigned', 'success')
    onClose()
  }

  function openFullForm() {
    const url = buildPrefillUrl({
      assigneeId: otherId,
      teamId:     form.teamId,
      title:      form.title,
      urgency:    form.urgency,
      dueDate:    form.dueDate,
      notes:      form.notes,
    })
    navigate(url)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-3">
      <div className="bg-white dark:bg-dark-card rounded-xl w-full max-w-sm p-4 shadow-elevated">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Assign a task to {otherProfile?.full_name}
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
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
              disabled={!form.title.trim() || busy}
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
