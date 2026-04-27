import { useState } from 'react'
import { Pencil, Trash2, Pause, Play, Repeat, Calendar, Users } from 'lucide-react'
import { useRecurrences } from '../../hooks/useRecurrences'
import { useAuth } from '../../hooks/useAuth'
import { showToast } from '../ui'
import { ModalWrapper } from '../ui/animations'
import { formatIntervalLabel, formatCountdown } from '../../lib/recurrence'
import RecurrenceEditorModal from './RecurrenceEditorModal'

// Display-only list of recurring templates owned by the caller (creators
// + admins + team managers, per RLS). Renders nothing when there are no
// templates — callers should also gate the tab visibility on hook output.
//
// Creation lives on AssignTaskPage; this surface only manages existing
// templates.
export default function RecurringList() {
  const { profile, isAdmin } = useAuth()
  const { templates, loading, setActive, deleteTemplate } = useRecurrences()
  const [editingId, setEditingId] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const editingTemplate = editingId ? templates.find(t => t.id === editingId) : null

  // Only show templates the caller created or admins everywhere — RLS
  // already gates the SELECT, so this is a UI-only refinement to hide
  // templates the user can't edit (e.g. seen via team-manager visibility
  // but not the creator).
  const ownedOrAdmin = templates.filter(t =>
    isAdmin || t.created_by === profile?.id
  )

  if (loading) {
    return <p className="p-5 text-sm text-slate-400">Loading recurring tasks…</p>
  }

  if (ownedOrAdmin.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-slate-400">
        <Repeat size={28} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
        No recurring tasks yet.
        <p className="mt-1 text-xs">Create one from <strong>Assign a Task</strong> by setting the Repeat field.</p>
      </div>
    )
  }

  return (
    <div className="card">
      <ul className="divide-y divide-slate-100 dark:divide-dark-border">
        {ownedOrAdmin.map(t => {
          const intervalLabel = formatIntervalLabel(t.interval_unit, t.interval_every)
          const nextRunCountdown = t.is_active && t.next_run_at
            ? formatCountdown(new Date(t.next_run_at))
            : null
          const canEdit = isAdmin || t.created_by === profile?.id
          return (
            <li key={t.id} className="p-4 sm:p-5 flex items-start gap-4 hover:bg-slate-50/50 dark:hover:bg-dark-hover/30">
              <Repeat size={16} className="text-purple-500 dark:text-purple-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <h3 className="font-medium text-slate-900 dark:text-white truncate">{t.template_title}</h3>
                  {!t.is_active && (
                    <span className="badge bg-slate-200 dark:bg-dark-hover text-slate-500 dark:text-slate-400 text-[10px]">
                      Paused
                    </span>
                  )}
                  <span className="badge bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 text-[10px]">
                    {intervalLabel}
                  </span>
                  {t.team?.name && (
                    <span className="badge bg-slate-100 dark:bg-dark-hover text-slate-600 dark:text-slate-300 text-[10px]">
                      {t.team.name}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                  {nextRunCountdown && (
                    <span className="flex items-center gap-1">
                      <Calendar size={11} />
                      Next: <span className="text-slate-700 dark:text-slate-200">{nextRunCountdown}</span>
                    </span>
                  )}
                  {t.assignees?.length > 0 && (
                    <span className="flex items-center gap-1">
                      <Users size={11} />
                      {t.assignees.map(a => a.full_name).filter(Boolean).join(', ')}
                    </span>
                  )}
                </div>
              </div>
              {canEdit && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={async () => {
                      const r = await setActive(t.id, !t.is_active)
                      if (!r.ok) showToast(r.msg || 'Failed', 'error')
                    }}
                    className="p-2 rounded-lg text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:text-slate-500 dark:hover:text-brand-300 dark:hover:bg-brand-500/10 transition-colors"
                    title={t.is_active ? 'Pause template' : 'Resume template'}
                    aria-label={t.is_active ? 'Pause template' : 'Resume template'}
                  >
                    {t.is_active ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button
                    onClick={() => setEditingId(t.id)}
                    className="p-2 rounded-lg text-slate-400 hover:text-brand-500 hover:bg-brand-50 dark:text-slate-500 dark:hover:text-brand-300 dark:hover:bg-brand-500/10 transition-colors"
                    title="Edit template"
                    aria-label="Edit template"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(t)}
                    className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:text-slate-500 dark:hover:text-red-400 dark:hover:bg-red-500/10 transition-colors"
                    title="Delete template"
                    aria-label="Delete template"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <RecurrenceEditorModal
        template={editingTemplate}
        open={!!editingTemplate}
        onClose={() => setEditingId(null)}
      />

      <ModalWrapper isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <div className="p-6 max-w-md">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-2">Delete recurring task?</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
            <strong>{deleteTarget?.template_title}</strong> will stop spawning tasks. Tasks already created stay (they'll lose the recurring marker).
          </p>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setDeleteTarget(null)} className="btn-ghost text-sm">Cancel</button>
            <button
              onClick={async () => {
                const r = await deleteTemplate(deleteTarget.id)
                if (!r.ok) showToast(r.msg || 'Failed', 'error')
                else showToast('Recurring task deleted')
                setDeleteTarget(null)
              }}
              className="btn-danger text-sm inline-flex items-center gap-1.5"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      </ModalWrapper>
    </div>
  )
}
