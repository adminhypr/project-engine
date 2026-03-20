import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTaskActions, useProfiles } from '../hooks/useTasks'
import { PageHeader, showToast } from '../components/ui'
import { AssignmentBadge } from '../components/ui'
import { getAssignmentType } from '../lib/assignmentType'
import { useAuth } from '../hooks/useAuth'
import { PageTransition, SuccessBurst } from '../components/ui/animations'
import { CheckCircle } from 'lucide-react'

export default function AssignTaskPage() {
  const { profile, isAdmin } = useAuth()
  const { assignTask } = useTaskActions()
  const { profiles, loading: profilesLoading } = useProfiles()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    assigneeId: '',
    title:      '',
    urgency:    'Med',
    dueDate:    '',
    whoTo:      '',
    notes:      ''
  })
  const [overrideAssignerId, setOverrideAssignerId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result,     setResult]     = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // Use override assigner for type preview if set
  const effectiveAssigner = overrideAssignerId
    ? profiles.find(p => p.id === overrideAssignerId)
    : profile
  const selectedAssignee = profiles.find(p => p.id === form.assigneeId)
  const previewType = selectedAssignee && effectiveAssigner
    ? getAssignmentType(effectiveAssigner, selectedAssignee)
    : null

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.assigneeId || !form.title.trim()) {
      showToast('Please fill in Assign To and Task Description', 'error')
      return
    }
    setSubmitting(true)
    const res = await assignTask({
      ...form,
      allProfiles: profiles,
      overrideAssignerId: overrideAssignerId || undefined
    })
    setSubmitting(false)

    if (res.ok) {
      setResult(res)
      setForm({ assigneeId: '', title: '', urgency: 'Med', dueDate: '', whoTo: '', notes: '' })
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
                Task <span className="font-mono font-semibold">{result.taskId}</span> has been assigned to{' '}
                <strong>{profiles.find(p => p.id === form.assigneeId)?.full_name || 'them'}</strong>.
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
                    value={form.assigneeId}
                    onChange={e => set('assigneeId', e.target.value)}
                    className="form-input"
                    required
                  >
                    <option value="">— Select person —</option>
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.full_name} ({p.teams?.name || 'No team'})
                      </option>
                    ))}
                  </select>
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

              {/* Admin-only: Assigned By override — conditionally rendered, not just hidden */}
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
                        {p.full_name} ({p.teams?.name || 'No team'})
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

              <div className="flex items-center gap-3 pt-2">
                <motion.button
                  type="submit"
                  disabled={submitting}
                  className="btn-primary"
                  whileTap={{ scale: 0.97 }}
                >
                  {submitting ? 'Assigning...' : 'Assign Task →'}
                </motion.button>
                <button type="button" className="btn-secondary" onClick={() =>
                  setForm({ assigneeId: '', title: '', urgency: 'Med', dueDate: '', whoTo: '', notes: '' })
                }>
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
