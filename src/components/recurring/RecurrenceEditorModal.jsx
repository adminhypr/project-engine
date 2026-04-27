import { useState, useMemo } from 'react'
import { useRecurrences } from '../../hooks/useRecurrences'
import { useProfiles } from '../../hooks/useTasks'
import { showToast } from '../ui'
import { ModalWrapper } from '../ui/animations'
import {
  computeNextRun,
  formatCountdown,
  validateTemplateDraft,
} from '../../lib/recurrence'

const URGENCIES = ['Low', 'Med', 'High', 'Urgent']
const UNITS = ['day', 'week', 'month']

// Drop-in modal that lets the user edit a recurring task template.
// Opened from:
//   • the Recurring tab's edit button (mode = 'edit')
//   • the spawned-task panel's "Edit recurring template..." link (mode = 'edit')
// Creation lives in the Assign a Task form, NOT in this modal.

function toLocalInputFromIso(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toIsoFromLocalInput(value) {
  if (!value) return null
  return new Date(value).toISOString()
}

export default function RecurrenceEditorModal({ template, open, onClose }) {
  const { updateTemplateAndSpawnedTasks, setAssignees } = useRecurrences()
  const { profiles: allProfiles, teams } = useProfiles({ excludeExternals: true })

  const [draft, setDraft] = useState(() => buildDraftFromTemplate(template))
  const [submitting, setSubmitting] = useState(false)
  const [showApplyConfirm, setShowApplyConfirm] = useState(false)

  // Reset the draft whenever a different template is loaded into the modal.
  useMemo(() => {
    setDraft(buildDraftFromTemplate(template))
  }, [template?.id])

  const previewNextRun = useMemo(() => {
    if (!draft.anchor_at) return null
    const anchor = new Date(draft.anchor_at)
    if (isNaN(anchor)) return null
    return computeNextRun({
      anchor,
      intervalUnit: draft.interval_unit,
      intervalEvery: draft.interval_every,
    })
  }, [draft.anchor_at, draft.interval_unit, draft.interval_every])

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))

  const toggleAssignee = (id) => {
    setDraft(d => {
      const has = d.assignee_ids.includes(id)
      return { ...d, assignee_ids: has ? d.assignee_ids.filter(x => x !== id) : [...d.assignee_ids, id] }
    })
  }

  const eligibleProfiles = (allProfiles || []).filter(p => p.role !== 'Agent' && p.role !== 'Client')

  // Save flow: validate first → show "Apply changes to" confirm → execute.
  function handleSaveClick() {
    const v = validateTemplateDraft(draft)
    if (!v.ok) { showToast(v.errors[0], 'error'); return }
    setShowApplyConfirm(true)
  }

  async function executeSave(applyMode) {
    setSubmitting(true)
    const patch = {
      template_title:            draft.template_title.trim(),
      template_notes:            draft.template_notes || null,
      template_icon:             draft.template_icon || null,
      template_urgency:          draft.template_urgency,
      template_due_offset_hours: draft.template_due_offset_hours,
      team_id:                   draft.team_id || null,
      interval_unit:             draft.interval_unit,
      interval_every:            draft.interval_every,
      anchor_at:                 toIsoFromLocalInput(draft.anchor_at),
      is_active:                 draft.is_active,
    }
    const r = await updateTemplateAndSpawnedTasks(template.id, patch, {
      applyToOpenSpawnedTasks: applyMode === 'all_open',
    })
    if (!r.ok) {
      showToast(r.msg || 'Failed to update', 'error')
      setSubmitting(false)
      return
    }
    const a = await setAssignees(template.id, draft.assignee_ids)
    if (!a.ok) {
      showToast(a.msg || 'Failed to update assignees', 'error')
      setSubmitting(false)
      return
    }
    showToast('Recurring task updated')
    setSubmitting(false)
    setShowApplyConfirm(false)
    onClose?.()
  }

  return (
    <>
      <ModalWrapper isOpen={open && !showApplyConfirm} onClose={onClose}>
        <div className="p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
            Edit recurring task
          </h3>

          <div className="space-y-4">
            <div>
              <label className="form-label">Title</label>
              <input
                type="text"
                value={draft.template_title}
                onChange={e => set('template_title', e.target.value)}
                className="form-input w-full"
                autoFocus
              />
            </div>

            <div>
              <label className="form-label">Notes (optional)</label>
              <textarea
                value={draft.template_notes}
                onChange={e => set('template_notes', e.target.value)}
                rows={2}
                className="form-input w-full resize-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="form-label">Urgency</label>
                <select
                  value={draft.template_urgency}
                  onChange={e => set('template_urgency', e.target.value)}
                  className="form-input w-full"
                >
                  {URGENCIES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Due in (hours after spawn)</label>
                <input
                  type="number"
                  min={0}
                  value={draft.template_due_offset_hours}
                  onChange={e => set('template_due_offset_hours', parseInt(e.target.value, 10) || 0)}
                  className="form-input w-full"
                />
              </div>
              <div>
                <label className="form-label">Team</label>
                <select
                  value={draft.team_id || ''}
                  onChange={e => set('team_id', e.target.value || null)}
                  className="form-input w-full"
                >
                  <option value="">— None —</option>
                  {(teams || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="form-label">Repeat every</label>
                <input
                  type="number"
                  min={1}
                  value={draft.interval_every}
                  onChange={e => set('interval_every', parseInt(e.target.value, 10) || 1)}
                  className="form-input w-full"
                />
              </div>
              <div>
                <label className="form-label">Unit</label>
                <select
                  value={draft.interval_unit}
                  onChange={e => set('interval_unit', e.target.value)}
                  className="form-input w-full"
                >
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Start at (ET)</label>
                <input
                  type="datetime-local"
                  value={draft.anchor_at}
                  onChange={e => set('anchor_at', e.target.value)}
                  className="form-input w-full"
                />
              </div>
            </div>

            {previewNextRun && (
              <div className="rounded-lg bg-brand-50 dark:bg-brand-500/10 px-3 py-2 text-xs text-brand-700 dark:text-brand-300">
                <strong>Next spawn:</strong> {previewNextRun.toLocaleString()} ({formatCountdown(previewNextRun)})
              </div>
            )}

            <div>
              <label className="form-label">Assignees ({draft.assignee_ids.length} selected)</label>
              <div className="rounded-xl border border-slate-200 dark:border-dark-border max-h-48 overflow-y-auto">
                {eligibleProfiles.length === 0 ? (
                  <p className="p-3 text-xs text-slate-400 italic">No eligible users.</p>
                ) : (
                  eligibleProfiles.map(p => {
                    const checked = draft.assignee_ids.includes(p.id)
                    return (
                      <label
                        key={p.id}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-dark-hover cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAssignee(p.id)}
                          className="rounded border-slate-300 dark:border-dark-border text-brand-500 focus:ring-brand-500"
                        />
                        <span className="text-sm text-slate-700 dark:text-slate-200 flex-1">{p.full_name}</span>
                        {checked && draft.assignee_ids[0] === p.id && (
                          <span className="text-[10px] uppercase tracking-wider text-brand-600 dark:text-brand-300">Primary</span>
                        )}
                      </label>
                    )
                  })
                )}
              </div>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={e => set('is_active', e.target.checked)}
                className="rounded border-slate-300 dark:border-dark-border text-brand-500 focus:ring-brand-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-200">Active</span>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-5">
            <button type="button" onClick={onClose} disabled={submitting} className="btn-ghost text-sm">
              Cancel
            </button>
            <button type="button" onClick={handleSaveClick} disabled={submitting} className="btn-primary text-sm">
              Save changes
            </button>
          </div>
        </div>
      </ModalWrapper>

      <ModalWrapper isOpen={showApplyConfirm} onClose={() => !submitting && setShowApplyConfirm(false)}>
        <div className="p-6 max-w-md w-full">
          <h3 className="font-semibold text-slate-900 dark:text-white mb-2">Apply changes to:</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Choose what these edits affect.
          </p>
          <div className="space-y-2 mb-5">
            <button
              type="button"
              onClick={() => executeSave('future_only')}
              disabled={submitting}
              className="w-full text-left rounded-xl border border-brand-300 bg-brand-50/50 dark:border-brand-500/30 dark:bg-brand-500/10 px-4 py-3 hover:bg-brand-50 dark:hover:bg-brand-500/15 transition-colors"
            >
              <div className="text-sm font-medium text-slate-900 dark:text-white">Future spawns only</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Existing tasks already assigned to people stay unchanged. Recommended.</div>
            </button>
            <button
              type="button"
              onClick={() => executeSave('all_open')}
              disabled={submitting}
              className="w-full text-left rounded-xl border border-slate-200 dark:border-dark-border bg-white dark:bg-dark-card px-4 py-3 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
            >
              <div className="text-sm font-medium text-slate-900 dark:text-white">Future spawns + existing open tasks</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Updates every still-open spawned task to match. Done tasks stay frozen.</div>
            </button>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowApplyConfirm(false)}
              disabled={submitting}
              className="btn-ghost text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </ModalWrapper>
    </>
  )
}

function buildDraftFromTemplate(t) {
  if (!t) {
    return {
      template_title: '',
      template_notes: '',
      template_icon: null,
      template_urgency: 'Med',
      template_due_offset_hours: 24,
      team_id: null,
      interval_unit: 'week',
      interval_every: 1,
      anchor_at: '',
      is_active: true,
      assignee_ids: [],
    }
  }
  return {
    template_title:            t.template_title || '',
    template_notes:            t.template_notes || '',
    template_icon:             t.template_icon || null,
    template_urgency:          t.template_urgency || 'Med',
    template_due_offset_hours: t.template_due_offset_hours ?? 24,
    team_id:                   t.team_id || null,
    interval_unit:             t.interval_unit || 'week',
    interval_every:            t.interval_every || 1,
    anchor_at:                 toLocalInputFromIso(t.anchor_at),
    is_active:                 t.is_active !== false,
    assignee_ids:              (t.assignees || []).map(a => a.id),
  }
}
