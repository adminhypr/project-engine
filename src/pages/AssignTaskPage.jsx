import { useState, useMemo, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useTaskActions, useProfiles } from '../hooks/useTasks'
import { PageHeader, showToast } from '../components/ui'
import { AssignmentBadge } from '../components/ui'
import { getAssignmentType } from '../lib/assignmentType'
import { useAuth } from '../hooks/useAuth'
import { PageTransition, SuccessBurst } from '../components/ui/animations'
import { CheckCircle, Users, X } from 'lucide-react'
import TaskIconPicker from '../components/ui/TaskIconPicker'
import { FilePickerInput, hasOversizedFiles } from '../components/ui/FileAttachment'
import { useAttachments } from '../hooks/useAttachments'
import { parsePrefillParams } from '../lib/dmPrefillUrl'

export default function AssignTaskPage() {
  const { profile, isAdmin } = useAuth()
  const { assignTask } = useTaskActions()
  const { profiles, loading: profilesLoading } = useProfiles()
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

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

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

  // Format team display in dropdowns
  function formatTeamNames(p) {
    if (p.all_teams?.length > 1) {
      return p.all_teams.map(t => t.name).join(', ')
    }
    return p.teams?.name || p.all_teams?.[0]?.name || 'No team'
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.assigneeIds.length || !form.title.trim()) {
      showToast('Please select at least one assignee and add a task description', 'error')
      return
    }
    if (form.dueDate && new Date(form.dueDate) < new Date()) {
      showToast('Due date must be in the future', 'error')
      return
    }
    if (hasOversizedFiles(pendingFiles)) {
      showToast('Remove files over 5 MB before submitting', 'error')
      return
    }
    setSubmitting(true)
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

  if (result) return (
    <PageTransition>
      <div>
        <PageHeader title="Assign a Task" />
        <div className="p-4 sm:p-6 max-w-lg">
          <SuccessBurst trigger={result.taskId}>
            <div className="card text-center py-10">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              >
                <CheckCircle size={48} className="text-emerald-500 mx-auto mb-4" />
              </motion.div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Task Assigned!</h3>
              <p className="text-slate-500 dark:text-slate-400 text-sm mb-3">
                Task <span className="font-mono font-semibold">{result.taskId}</span> has been assigned.
              </p>
              <div className="flex items-center justify-center gap-2 mb-6">
                <span className="text-sm text-slate-500">Assignment type:</span>
                <AssignmentBadge type={result.assignmentType} />
              </div>
              <div className="flex gap-3 justify-center">
                <button className="btn-primary" onClick={() => setResult(null)}>Assign Another</button>
                <button className="btn-secondary" onClick={() => navigate('/my-tasks')}>View My Tasks</button>
              </div>
            </div>
          </SuccessBurst>
        </div>
      </div>
    </PageTransition>
  )

  return (
    <PageTransition>
      <div>
        <PageHeader title="Assign a Task" subtitle="Assign a task to anyone in your organization" />

        <div className="p-4 sm:p-6 max-w-2xl">
          <div className="card">
            <form onSubmit={handleSubmit} className="space-y-5">

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Assign To *</label>
                  <select
                    value=""
                    onChange={e => handleAddAssignee(e.target.value)}
                    className="form-input"
                  >
                    <option value="">— Add person —</option>
                    {profiles.filter(p => !form.assigneeIds.includes(p.id)).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.full_name} ({formatTeamNames(p)})
                      </option>
                    ))}
                  </select>
                  {form.assigneeIds.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {form.assigneeIds.map((id, i) => {
                        const p = profiles.find(pr => pr.id === id)
                        return (
                          <span
                            key={id}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium
                              ${i === 0
                                ? 'bg-brand-50 text-brand-700 border border-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:border-brand-500/30'
                                : 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-dark-hover dark:text-slate-300 dark:border-dark-border'
                              }`}
                          >
                            {p?.full_name || 'Unknown'}
                            {i === 0 && <span className="text-[10px] opacity-60 ml-0.5">primary</span>}
                            <button
                              type="button"
                              onClick={() => handleRemoveAssignee(id)}
                              className="text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 ml-0.5"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  )}
                  {previewType && (
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      Assignment type: <AssignmentBadge type={previewType} />
                    </div>
                  )}
                </div>

                <div>
                  <label className="form-label">Urgency</label>
                  <select value={form.urgency} onChange={e => set('urgency', e.target.value)} className="form-input">
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
                    <label className="form-label flex items-center gap-1.5">
                      <Users size={14} className="text-brand-500" />
                      Which team is this task for?
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {assigneeTeams.map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setSelectedTeamId(t.id)}
                          className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all duration-150
                            ${selectedTeamId === t.id
                              ? 'bg-brand-50 text-brand-700 border-brand-200 ring-1 ring-brand-300 dark:bg-brand-500/15 dark:text-brand-300 dark:border-brand-500/30 dark:ring-brand-500/40'
                              : 'bg-white text-slate-600 border-slate-200 hover:border-brand-200 hover:text-brand-600 dark:bg-dark-surface dark:text-slate-300 dark:border-dark-border dark:hover:border-brand-500/30'
                            }`}
                        >
                          {t.name}
                          {t.is_primary && (
                            <span className="ml-1.5 text-xs text-slate-400 dark:text-slate-500">primary</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Admin-only: Assigned By override */}
              {isAdmin && (
                <div>
                  <label className="form-label">Assigned By (override)</label>
                  <select
                    value={overrideAssignerId}
                    onChange={e => setOverrideAssignerId(e.target.value)}
                    className="form-input"
                  >
                    <option value="">— {profile?.full_name} (you) —</option>
                    {profiles.filter(p => p.id !== profile?.id).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.full_name} ({formatTeamNames(p)})
                      </option>
                    ))}
                  </select>
                  {overrideAssignerId && (
                    <p className="text-xs text-brand-500 mt-1">
                      Task will be recorded as assigned by {profiles.find(p => p.id === overrideAssignerId)?.full_name}
                    </p>
                  )}
                </div>
              )}

              <div>
                <label className="form-label">Task Description *</label>
                <textarea
                  value={form.title}
                  onChange={e => set('title', e.target.value)}
                  placeholder="Describe what needs to be done..."
                  rows={3}
                  className="form-input resize-none"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Due Date (optional)</label>
                  <input
                    type="datetime-local"
                    value={form.dueDate}
                    onChange={e => set('dueDate', e.target.value)}
                    min={new Date().toISOString().slice(0, 16)}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Who It's For (optional)</label>
                  <input
                    type="text"
                    value={form.whoTo}
                    onChange={e => set('whoTo', e.target.value)}
                    placeholder="Client, project, department..."
                    className="form-input"
                  />
                </div>
              </div>

              <div>
                <label className="form-label">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="Extra context, links, instructions..."
                  rows={3}
                  className="form-input resize-none"
                />
              </div>

              <div>
                <label className="form-label">Attachments (optional)</label>
                <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">Max 5 MB per file. For larger files, upload to Google Drive and paste the link in Notes.</p>
                <FilePickerInput files={pendingFiles} onChange={setPendingFiles} />
              </div>

              <div>
                <label className="form-label">Task Icon (optional)</label>
                <TaskIconPicker value={form.icon} onChange={v => set('icon', v)} />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <motion.button
                  type="submit"
                  disabled={submitting || hasOversizedFiles(pendingFiles)}
                  className="btn-primary"
                  whileTap={{ scale: 0.97 }}
                >
                  {submitting ? 'Assigning...' : 'Assign Task →'}
                </motion.button>
                <button type="button" className="btn-secondary" onClick={() => {
                  setForm({ assigneeIds: [], title: '', urgency: 'Med', dueDate: '', whoTo: '', notes: '', icon: '' })
                  setPendingFiles([])
                  setSelectedTeamId('')
                }}>
                  Clear
                </button>
                <p className="text-xs text-slate-400 dark:text-slate-500 ml-2">
                  Assigned by field is auto-filled from your login
                </p>
              </div>

            </form>
          </div>

          {/* Type legend */}
          <div className="mt-4 p-4 bg-white dark:bg-dark-card rounded-2xl border border-slate-200 dark:border-dark-border text-sm">
            <p className="font-semibold text-slate-600 dark:text-slate-300 mb-2 text-xs uppercase tracking-wider">Assignment Type Guide</p>
            <div className="flex flex-wrap gap-3">
              {[
                ['Superior',  'Your manager/admin assigned this to you'],
                ['Peer',      'Same role, same team'],
                ['CrossTeam', 'Different team assignment'],
                ['Upward',    'Assigned to someone above your rank'],
              ].map(([type, desc]) => (
                <div key={type} className="flex items-center gap-2">
                  <AssignmentBadge type={type} />
                  <span className="text-xs text-slate-500 dark:text-slate-400">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageTransition>
  )
}
