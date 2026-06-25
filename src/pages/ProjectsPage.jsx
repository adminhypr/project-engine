import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, KanbanSquare, Users as UsersIcon } from 'lucide-react'
import { useProjects } from '../hooks/useProjects'
import { useTasks } from '../hooks/useTasks'
import { featureProgress, projectProgress } from '../lib/projectBoard'
import { PageHeader, LoadingScreen, EmptyState, showToast } from '../components/ui'
import { PageTransition, ModalWrapper } from '../components/ui/animations'
import { usePageTitle } from '../hooks/usePageTitle'

const STATUS_STYLES = {
  'Active':    'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  'On Hold':   'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'Completed': 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  'Archived':  'bg-slate-100 text-slate-500 dark:bg-dark-border dark:text-slate-400',
}

export default function ProjectsPage() {
  usePageTitle('Dev Projects')
  const navigate = useNavigate()
  const { projects, loading, createProject } = useProjects()
  const { tasks } = useTasks()
  const [showNew, setShowNew] = useState(false)

  // Per-project overall progress + feature count, derived from the already-
  // loaded tasks context (no extra fetch).
  const progressByProject = useMemo(() => {
    const map = new Map()
    for (const p of projects) {
      const features = tasks.filter(t => t.project_id === p.id)
      const pcts = features.map(f => ({ pct: featureProgress(f).pct }))
      map.set(p.id, { pct: projectProgress(pcts), count: features.length })
    }
    return map
  }, [projects, tasks])

  if (loading) return <LoadingScreen />

  const newButton = (
    <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-1.5">
      <Plus size={16} /> New Project
    </button>
  )

  return (
    <PageTransition>
      <div>
        <PageHeader title="Dev Projects" subtitle="Developer project boards" actions={newButton} />

        <div className="p-4 sm:p-6">
          {projects.length === 0 ? (
            <EmptyState
              icon="🗂️"
              title="No projects yet"
              description="Create a project to start tracking features and requests on a board."
              action={newButton}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map(p => {
                const prog = progressByProject.get(p.id) || { pct: 0, count: 0 }
                return (
                  <button
                    key={p.id}
                    onClick={() => navigate(`/projects/${p.id}`)}
                    className="card text-left hover:shadow-elevated transition-shadow p-4 flex flex-col gap-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-8 h-8 rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300 grid place-items-center shrink-0">
                          <KanbanSquare size={16} />
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-white truncate">{p.name}</span>
                      </div>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[p.status] || STATUS_STYLES.Active}`}>
                        {p.status}
                      </span>
                    </div>

                    {p.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{p.description}</p>
                    )}

                    <div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        <span>{prog.count} feature{prog.count !== 1 ? 's' : ''}</span>
                        <span>{prog.pct}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-100 dark:bg-dark-border overflow-hidden">
                        <div className="h-full bg-brand-500 rounded-full" style={{ width: `${prog.pct}%` }} />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
                      <span className="inline-flex items-center gap-1"><UsersIcon size={12} /> {p.member_count}</span>
                      {p.target_date && <span>Due {new Date(p.target_date).toLocaleDateString()}</span>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <NewProjectModal
          isOpen={showNew}
          onClose={() => setShowNew(false)}
          onCreate={async ({ name, description }) => {
            const p = await createProject({ name, description })
            setShowNew(false)
            if (p?.id) navigate(`/projects/${p.id}`)
          }}
        />
      </div>
    </PageTransition>
  )
}

function NewProjectModal({ isOpen, onClose, onCreate }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) { showToast('Project name is required', 'error'); return }
    setBusy(true)
    await onCreate({ name, description })
    setBusy(false)
    setName(''); setDescription('')
  }

  return (
    <ModalWrapper isOpen={isOpen} onClose={onClose}>
      <div className="bg-white dark:bg-dark-card rounded-2xl w-full max-w-md p-5 shadow-elevated">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">New Project</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Name</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              className="form-input w-full"
              placeholder="e.g. HyperVoice"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              className="form-input w-full resize-none"
              placeholder="What is this project about?"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={submit} disabled={busy} className="btn-primary">{busy ? 'Creating…' : 'Create'}</button>
        </div>
      </div>
    </ModalWrapper>
  )
}
