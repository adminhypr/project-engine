import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useTaskActions, useProfiles } from '../hooks/useTasks'
import { useRecurrences } from '../hooks/useRecurrences'
import { showToast } from '../components/ui'
import { getAssignmentType } from '../lib/assignmentType'
import { useAuth } from '../hooks/useAuth'
import { PageTransition, SuccessBurst } from '../components/ui/animations'
import { CheckCircle, Users, X, Repeat as RepeatIcon, Loader2, Search } from 'lucide-react'
import { computeNextRun, formatCountdown } from '../lib/recurrence'
import TaskIconPicker from '../components/ui/TaskIconPicker'
import { FilePickerInput, hasOversizedFiles } from '../components/ui/FileAttachment'
import { useAttachments } from '../hooks/useAttachments'
import { parsePrefillParams } from '../lib/dmPrefillUrl'
import { usePageTitle } from '../hooks/usePageTitle'
import { Avatar } from '../components/projects/DataTable'
import './assignTaskVibe.css'

// Solid Vibe label chip for the four assignment types (replaces the coral
// AssignmentBadge on this monday-themed page; same labels/semantics).
const ASSIGN_COLORS = { Superior: '#5559df', Peer: '#00c875', CrossTeam: '#fdab3d', Upward: '#a25ddc' }
function VibeAssignmentBadge({ type }) {
  return <span className="vibe-label-chip" style={{ background: ASSIGN_COLORS[type] || '#c3c6d4' }}>{type}</span>
}

function teamLabel(p) {
  if (p.all_teams?.length > 1) return p.all_teams.map(t => t.name).join(', ')
  return p.teams?.name || p.all_teams?.[0]?.name || 'No team'
}

// monday-style People picker: avatar chips + a searchable avatar dropdown.
// Pure presentation over the page's existing add/remove handlers.
function PersonPicker({ profiles, selectedIds, onAdd, onRemove, error }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const selected = selectedIds.map(id => profiles.find(p => p.id === id)).filter(Boolean)
  const available = profiles.filter(p =>
    !selectedIds.includes(p.id) && (p.full_name || '').toLowerCase().includes(q.toLowerCase()),
  )

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        className={`vibe-input ${error ? 'vibe-input--error' : ''}`}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', cursor: 'text', minHeight: 42, padding: '6px 10px' }}
        onClick={() => setOpen(true)}
      >
        {selected.map((p, i) => (
          <span key={p.id} className={`vibe-chip ${i === 0 ? 'vibe-chip--primary' : ''}`}>
            <Avatar profile={p} size={20} />
            {p.full_name}
            {i === 0 && <span style={{ fontSize: 10, opacity: 0.6 }}>primary</span>}
            <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(p.id) }} aria-label={`Remove ${p.full_name}`}>
              <X size={12} />
            </button>
          </span>
        ))}
        <span className="vibe-help" style={{ padding: '2px 4px' }}>{selected.length ? '+ Add person' : '— Add person —'}</span>
      </div>

      {open && (
        <div className="vibe-popover" style={{ position: 'absolute', zIndex: 30, top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 280, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--v-border)', position: 'sticky', top: 0, background: 'var(--v-surface)' }}>
            <Search size={14} color="#676879" />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search names…"
              style={{ border: 0, outline: 'none', flex: 1, fontSize: 13, fontFamily: 'inherit', color: '#323338', background: 'transparent' }}
            />
          </div>
          {available.length === 0 && <div className="vibe-help" style={{ padding: 12 }}>No people found.</div>}
          {available.map(p => (
            <button type="button" key={p.id} className="vibe-option" onClick={() => { onAdd(p.id); setQ('') }}>
              <Avatar profile={p} size={28} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600 }}>{p.full_name}</span>
                <span className="vibe-help" style={{ display: 'block' }}>{teamLabel(p)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AssignTaskPage() {
  usePageTitle('Assign a Task')
  const { profile, isAdmin } = useAuth()
  const { assignTask } = useTaskActions()
  const { createTemplate } = useRecurrences()
  const { profiles, loading: profilesLoading } = useProfiles({ excludeExternals: true })
  const { uploadAttachments } = useAttachments()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    assigneeIds: [],
    title:       '',
    urgency:     'Med',
    dueDate:     '',
    whoTo:       '',
    notes:       '',
    icon:        ''
  })
  const [pendingFiles, setPendingFiles] = useState([])
  const [overrideAssignerId, setOverrideAssignerId] = useState('')
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result,     setResult]     = useState(null)
  // Per-field validation errors, shown inline next to the offending field
  // instead of as fire-and-forget toasts.
  const [errors, setErrors] = useState({})

  // Recurrence state — sits next to the form but doesn't merge into it
  // because it only applies when repeat !== 'none'.
  const [repeat, setRepeat] = useState('none') // 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'custom'
  const [customEvery, setCustomEvery] = useState(1)
  const [customUnit, setCustomUnit]   = useState('week') // 'day' | 'week' | 'month'
  const [startAt, setStartAt]         = useState(() => {
    // Default = now in local time, formatted for datetime-local.
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [dueOffsetHours, setDueOffsetHours] = useState(24)

  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    if (profilesLoading) return
    const pre = parsePrefillParams(searchParams)
    if (!pre.assigneeId && !pre.title) return

    setForm(f => ({
      ...f,
      assigneeIds: pre.assigneeId ? [pre.assigneeId] : f.assigneeIds,
      title:       pre.title    ?? f.title,
      urgency:     pre.urgency  ?? f.urgency,
      dueDate:     pre.dueDate  ?? f.dueDate,
      notes:       pre.notes    ?? f.notes,
    }))
    if (pre.teamId) setSelectedTeamId(pre.teamId)

    // Clear params so refresh doesn't re-apply
    setSearchParams({}, { replace: true })
  }, [profilesLoading, searchParams, setSearchParams])

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => (e[k] ? { ...e, [k]: undefined } : e))
  }

  // Primary assignee is the first selected
  const primaryAssignee = profiles.find(p => p.id === form.assigneeIds[0])

  // Use override assigner for type preview if set
  const effectiveAssigner = overrideAssignerId
    ? profiles.find(p => p.id === overrideAssignerId)
    : profile
  const previewType = primaryAssignee && effectiveAssigner
    ? getAssignmentType(effectiveAssigner, primaryAssignee, selectedTeamId || undefined)
    : null

  // Multi-team: does the primary assignee have multiple teams?
  const assigneeTeams = useMemo(() => {
    if (!primaryAssignee) return []
    return primaryAssignee.all_teams || (primaryAssignee.teams ? [{ id: primaryAssignee.team_id, name: primaryAssignee.teams.name, is_primary: true }] : [])
  }, [primaryAssignee])

  const showTeamPicker = assigneeTeams.length > 1

  // Add an assignee
  function handleAddAssignee(assigneeId) {
    if (!assigneeId || form.assigneeIds.includes(assigneeId)) return
    const newIds = [...form.assigneeIds, assigneeId]
    set('assigneeIds', newIds)
    setErrors(e => (e.assignees ? { ...e, assignees: undefined } : e))
    // Auto-select primary team from first assignee
    if (newIds.length === 1) {
      const assignee = profiles.find(p => p.id === assigneeId)
      if (assignee) {
        const primary = assignee.all_teams?.find(t => t.is_primary)
        setSelectedTeamId(primary?.id || assignee.team_id || '')
      }
    }
  }

  // Remove an assignee
  function handleRemoveAssignee(assigneeId) {
    const newIds = form.assigneeIds.filter(id => id !== assigneeId)
    set('assigneeIds', newIds)
    if (newIds.length === 0) setSelectedTeamId('')
    // If primary was removed, update team from new primary
    if (form.assigneeIds[0] === assigneeId && newIds.length > 0) {
      const newPrimary = profiles.find(p => p.id === newIds[0])
      if (newPrimary) {
        const primary = newPrimary.all_teams?.find(t => t.is_primary)
        setSelectedTeamId(primary?.id || newPrimary.team_id || '')
      }
    }
  }

  // Repeat preset → (interval_unit, interval_every) tuple. Used at submit time.
  function repeatToInterval() {
    switch (repeat) {
      case 'daily':    return { unit: 'day',   every: 1 }
      case 'weekly':   return { unit: 'week',  every: 1 }
      case 'biweekly': return { unit: 'week',  every: 2 }
      case 'monthly':  return { unit: 'month', every: 1 }
      case 'yearly':   return { unit: 'month', every: 12 }
      case 'custom':   return { unit: customUnit, every: Math.max(1, customEvery) }
      default:         return null
    }
  }

  // Live "First spawn" preview shown under the Start picker.
  const recurrencePreview = useMemo(() => {
    if (repeat === 'none') return null
    const interval = repeatToInterval()
    if (!interval) return null
    const anchor = startAt ? new Date(startAt) : null
    if (!anchor || isNaN(anchor)) return null
    const next = computeNextRun({
      anchor,
      intervalUnit: interval.unit,
      intervalEvery: interval.every,
    })
    return { anchor, next }
    // intentionally omitting customEvery / customUnit from deps — they
    // change repeatToInterval's output via state read, and React will
    // re-render this component on those state changes anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeat, startAt, customEvery, customUnit])

  // One-off path validates the dueDate field. Recurring path uses startAt
  // instead and validates that the start is at least 1 minute in the future.
  function validate() {
    const errs = {}
    if (!form.assigneeIds.length) errs.assignees = 'Select at least one assignee'
    if (!form.title.trim()) errs.title = 'Describe what needs to be done'
    if (repeat === 'none') {
      if (form.dueDate && new Date(form.dueDate) < new Date()) {
        errs.dueDate = 'Due date must be in the future'
      }
    } else {
      const startMs = startAt ? new Date(startAt).getTime() : NaN
      if (!Number.isFinite(startMs)) {
        errs.startAt = 'Pick a Start date for the recurring task'
      } else if (startMs < Date.now() + 60 * 1000) {
        errs.startAt = 'Start must be at least 1 minute in the future'
      }
    }
    if (hasOversizedFiles(pendingFiles)) {
      errs.files = 'Remove files over 5 MB before submitting'
    }
    return errs
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errs = validate()
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    setSubmitting(true)

    // Recurrence path — create a template; the hook handles the immediate
    // first-occurrence spawn for "Start = now/past" via the edge function.
    if (repeat !== 'none') {
      const interval = repeatToInterval()
      const r = await createTemplate({
        template_title:            form.title.trim(),
        template_notes:            form.notes || null,
        template_icon:             form.icon || null,
        template_urgency:          form.urgency || 'Med',
        template_due_offset_hours: Math.max(0, dueOffsetHours || 24),
        team_id:                   (showTeamPicker ? selectedTeamId : null) || null,
        interval_unit:             interval.unit,
        interval_every:            interval.every,
        anchor_at:                 new Date(startAt).toISOString(),
        is_active:                 true,
        assignee_ids:              form.assigneeIds,
      })
      setSubmitting(false)
      if (!r.ok) { showToast(r.msg || 'Failed to create recurring task', 'error'); return }
      showToast('Recurring task created')
      // Soft reset.
      setForm({ assigneeIds: [], title: '', urgency: 'Med', dueDate: '', whoTo: '', notes: '', icon: '' })
      setPendingFiles([])
      setSelectedTeamId('')
      setRepeat('none')
      // Push to My Tasks → Recurring tab so the user sees what they just made.
      navigate('/my-tasks?tab=recurring')
      return
    }

    // One-off task path (existing flow).
    const res = await assignTask({
      ...form,
      allProfiles: profiles,
      overrideAssignerId: overrideAssignerId || undefined,
      teamId: showTeamPicker ? selectedTeamId : undefined
    })
    setSubmitting(false)

    if (res.ok) {
      if (pendingFiles.length > 0) {
        const upload = await uploadAttachments(res.task.id, pendingFiles)
        if (!upload.ok) {
          showToast('Task created but some files failed to upload', 'error')
        }
      }
      setResult(res)
      setForm({ assigneeIds: [], title: '', urgency: 'Med', dueDate: '', whoTo: '', notes: '', icon: '' })
      setPendingFiles([])
      setSelectedTeamId('')
    } else {
      showToast(res.msg, 'error')
    }
  }

  function clearForm() {
    setForm({ assigneeIds: [], title: '', urgency: 'Med', dueDate: '', whoTo: '', notes: '', icon: '' })
    setPendingFiles([])
    setSelectedTeamId('')
  }

  if (result) return (
    <PageTransition>
      <div className="vibe-scope vibe-page">
        <div className="vibe-header px-4 sm:px-6 pt-5 pb-4">
          <h1 className="text-xl">Assign a Task</h1>
        </div>
        <div className="p-4 sm:p-6 max-w-lg">
          <SuccessBurst trigger={result.taskId}>
            <div className="vibe-card text-center py-10 px-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              >
                <CheckCircle size={48} style={{ color: '#00c875' }} className="mx-auto mb-4" />
              </motion.div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: '#323338' }}>Task Assigned!</h3>
              <p className="text-sm mb-3" style={{ color: '#676879' }}>
                Task <span className="font-mono font-semibold">{result.taskId}</span> has been assigned.
              </p>
              <div className="flex items-center justify-center gap-2 mb-6">
                <span className="text-sm" style={{ color: '#676879' }}>Assignment type:</span>
                <VibeAssignmentBadge type={result.assignmentType} />
              </div>
              <div className="flex gap-3 justify-center">
                <button className="vibe-btn vibe-btn-primary" onClick={() => setResult(null)}>Assign Another</button>
                <button className="vibe-btn vibe-btn-secondary" onClick={() => navigate('/my-tasks')}>View My Tasks</button>
              </div>
            </div>
          </SuccessBurst>
        </div>
      </div>
    </PageTransition>
  )

  return (
    <PageTransition>
      <div className="vibe-scope vibe-page">
        <div className="vibe-header px-4 sm:px-6 pt-5 pb-4">
          <h1 className="text-xl">Assign a Task</h1>
          <p className="text-sm mt-0.5" style={{ color: '#676879' }}>Assign a task to anyone in your organization</p>
        </div>

        <div className="p-4 sm:p-6 max-w-2xl">
          <div className="vibe-card p-5 sm:p-6">
            <form onSubmit={handleSubmit} className="space-y-5">

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="vibe-label">Assign To *</label>
                  <PersonPicker
                    profiles={profiles}
                    selectedIds={form.assigneeIds}
                    onAdd={handleAddAssignee}
                    onRemove={handleRemoveAssignee}
                    error={!!errors.assignees}
                  />
                  {errors.assignees && <p className="vibe-error">{errors.assignees}</p>}
                  {previewType && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs" style={{ color: '#676879' }}>
                      Assignment type: <VibeAssignmentBadge type={previewType} />
                    </div>
                  )}
                </div>

                <div>
                  <label className="vibe-label">Urgency</label>
                  <select
                    value={form.urgency}
                    onChange={e => set('urgency', e.target.value)}
                    className={`vibe-input vibe-input--${form.urgency.toLowerCase()}`}
                  >
                    <option>Med</option>
                    <option>High</option>
                    <option>Low</option>
                  </select>
                </div>
              </div>

              {/* Team picker — shown only when assignee has multiple teams */}
              <AnimatePresence>
                {showTeamPicker && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <label className="vibe-label flex items-center gap-1.5">
                      <Users size={14} style={{ color: '#0073ea' }} />
                      Which team is this task for?
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {assigneeTeams.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setSelectedTeamId(t.id)}
                          className={`vibe-seg ${selectedTeamId === t.id ? 'vibe-seg--active' : ''}`}
                        >
                          {t.name}
                          {t.is_primary && <span style={{ marginLeft: 6, fontSize: 11, color: '#9699a6' }}>primary</span>}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Admin-only: Assigned By override */}
              {isAdmin && (
                <div>
                  <label className="vibe-label">Assigned By (override)</label>
                  <select
                    value={overrideAssignerId}
                    onChange={e => setOverrideAssignerId(e.target.value)}
                    className="vibe-input"
                  >
                    <option value="">— {profile?.full_name} (you) —</option>
                    {profiles.filter(p => p.id !== profile?.id).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.full_name} ({teamLabel(p)})
                      </option>
                    ))}
                  </select>
                  {overrideAssignerId && (
                    <p className="text-xs mt-1" style={{ color: '#0073ea' }}>
                      Task will be recorded as assigned by {profiles.find(p => p.id === overrideAssignerId)?.full_name}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="vibe-label">Task Description *</label>
                <textarea
                  value={form.title}
                  onChange={e => set('title', e.target.value)}
                  placeholder="Describe what needs to be done..."
                  rows={3}
                  className={`vibe-input ${errors.title ? 'vibe-input--error' : ''}`}
                  aria-required="true"
                  aria-invalid={!!errors.title}
                />
                {errors.title && <p className="vibe-error">{errors.title}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {repeat === 'none' ? (
                  <div>
                    <label className="vibe-label">Due Date (optional)</label>
                    <input
                      type="datetime-local"
                      value={form.dueDate}
                      onChange={e => set('dueDate', e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                      className={`vibe-input ${errors.dueDate ? 'vibe-input--error' : ''}`}
                      aria-invalid={!!errors.dueDate}
                    />
                    {errors.dueDate && <p className="vibe-error">{errors.dueDate}</p>}
                  </div>
                ) : (
                  <div>
                    <label className="vibe-label">Due in (hours after spawn)</label>
                    <input
                      type="number"
                      min={0}
                      value={dueOffsetHours}
                      onChange={e => setDueOffsetHours(parseInt(e.target.value, 10) || 0)}
                      className="vibe-input"
                    />
                  </div>
                )}
                <div>
                  <label className="vibe-label">Who It's For (optional)</label>
                  <input
                    type="text"
                    value={form.whoTo}
                    onChange={e => set('whoTo', e.target.value)}
                    placeholder="Client, project, department..."
                    className="vibe-input"
                  />
                </div>
              </div>

              {/* Repeat — leave at "Don't repeat" for one-off tasks. */}
              <div className="space-y-3">
                <div>
                  <label className="vibe-label flex items-center gap-1.5">
                    <RepeatIcon size={13} style={{ color: '#676879' }} /> Repeat
                  </label>
                  <select
                    value={repeat}
                    onChange={e => setRepeat(e.target.value)}
                    className="vibe-input"
                  >
                    <option value="none">Don't repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 weeks</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="custom">Custom…</option>
                  </select>
                </div>

                {repeat === 'custom' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="vibe-label">Every</label>
                      <input
                        type="number"
                        min={1}
                        value={customEvery}
                        onChange={e => setCustomEvery(parseInt(e.target.value, 10) || 1)}
                        className="vibe-input"
                      />
                    </div>
                    <div>
                      <label className="vibe-label">Unit</label>
                      <select
                        value={customUnit}
                        onChange={e => setCustomUnit(e.target.value)}
                        className="vibe-input"
                      >
                        <option value="day">day(s)</option>
                        <option value="week">week(s)</option>
                        <option value="month">month(s)</option>
                      </select>
                    </div>
                  </div>
                )}

                {repeat !== 'none' && (
                  <div>
                    <label className="vibe-label">Start (ET)</label>
                    <input
                      type="datetime-local"
                      value={startAt}
                      onChange={e => { setStartAt(e.target.value); setErrors(er => (er.startAt ? { ...er, startAt: undefined } : er)) }}
                      className={`vibe-input ${errors.startAt ? 'vibe-input--error' : ''}`}
                      aria-invalid={!!errors.startAt}
                    />
                    {errors.startAt && <p className="vibe-error">{errors.startAt}</p>}
                    {recurrencePreview?.next && (
                      <p className="text-xs mt-1.5" style={{ color: '#0073ea' }}>
                        <strong>First spawn:</strong>{' '}
                        {recurrencePreview.next.toLocaleString()} ({formatCountdown(recurrencePreview.next)})
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="vibe-label">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="Extra context, links, instructions..."
                  rows={3}
                  className="vibe-input"
                />
              </div>

              <div>
                <label className="vibe-label">Attachments (optional)</label>
                <p className="vibe-help mb-1">Max 5 MB per file. For larger files, upload to Google Drive and paste the link in Notes.</p>
                <FilePickerInput files={pendingFiles} onChange={files => { setPendingFiles(files); setErrors(er => (er.files ? { ...er, files: undefined } : er)) }} />
                {errors.files && <p className="vibe-error">{errors.files}</p>}
              </div>

              <div>
                <label className="vibe-label">Task Icon (optional)</label>
                <TaskIconPicker value={form.icon} onChange={v => set('icon', v)} />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <motion.button
                  type="submit"
                  disabled={submitting || hasOversizedFiles(pendingFiles)}
                  className="vibe-btn vibe-btn-primary"
                  whileTap={{ scale: 0.97 }}
                >
                  {submitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                  {submitting ? 'Assigning…' : 'Assign Task →'}
                </motion.button>
                <button type="button" className="vibe-btn vibe-btn-secondary" onClick={clearForm}>
                  Clear
                </button>
                <p className="vibe-help ml-2">
                  Assigned by field is auto-filled from your login
                </p>
              </div>

            </form>
          </div>

          {/* Type legend */}
          <div className="vibe-card mt-4 p-4 text-sm">
            <p className="font-semibold mb-2 text-xs uppercase tracking-wider" style={{ color: '#676879' }}>Assignment Type Guide</p>
            <div className="flex flex-wrap gap-3">
              {[
                ['Superior',  'Your manager/admin assigned this to you'],
                ['Peer',      'Same role, same team'],
                ['CrossTeam', 'Different team assignment'],
                ['Upward',    'Assigned to someone above your rank'],
              ].map(([type, desc]) => (
                <div key={type} className="flex items-center gap-2">
                  <VibeAssignmentBadge type={type} />
                  <span className="text-xs" style={{ color: '#676879' }}>{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageTransition>
  )
}
