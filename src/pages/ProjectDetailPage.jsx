import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { List, Columns3, ArrowLeft, Users as UsersIcon } from 'lucide-react'
import { useProjects, useProjectMembers } from '../hooks/useProjects'
import { useAuth } from '../hooks/useAuth'
import { useTasks } from '../hooks/useTasks'
import { useProjectColumns, useProjectFeatures } from '../hooks/useProjectBoard'
import { useFeatureRequests } from '../hooks/useFeatureRequests'
import { projectProgress, featureProgress, filterFeatures, EMPTY_FEATURE_FILTERS } from '../lib/projectBoard'
import FeaturesFilterBar from '../components/projects/FeaturesFilterBar'
import ProjectStats from '../components/projects/ProjectStats'
import { LoadingScreen, EmptyState } from '../components/ui'
import { PageTransition } from '../components/ui/animations'
import { usePageTitle } from '../hooks/usePageTitle'
import TaskDetailPanel from '../components/tasks/TaskDetailPanel'
import RequestEditModal from '../components/projects/RequestEditModal'
import FeatureList from '../components/projects/FeatureList'
import FeatureBoard from '../components/projects/FeatureBoard'
import RequestList from '../components/projects/RequestList'
import RequestBoard from '../components/projects/RequestBoard'
import { useBugs } from '../hooks/useBugs'
import BugList from '../components/projects/BugList'
import BugBoard from '../components/projects/BugBoard'
import BugEditModal from '../components/projects/BugEditModal'
import ProjectMembersModal from '../components/projects/ProjectMembersModal'

const VIEW_KEY = 'pe-project-view'

const STATUS_STYLES = {
  'Active':    'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  'On Hold':   'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  'Completed': 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  'Archived':  'bg-slate-100 text-slate-500 dark:bg-dark-border dark:text-slate-400',
}

export default function ProjectDetailPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { projects, loading: projectsLoading } = useProjects()
  const project = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId])
  usePageTitle(project?.name || 'Project')

  const { columns, loading: columnsLoading, addColumn, updateColumn, deleteColumn } = useProjectColumns(projectId)
  const { features, addFeature, moveFeature } = useProjectFeatures(projectId)
  const requests = useFeatureRequests(projectId)
  const bugs = useBugs(projectId)
  const projectMembers = useProjectMembers(projectId)
  const members = projectMembers.members
  const { tasks, refetch: refetchTasks } = useTasks()
  const currentUserId = profile?.id || null
  const [showMembers, setShowMembers] = useState(false)

  // Features filter (Mine / Urgency / Due). Applies to the Features board + list
  // only — Requests/Bugs are status backlogs without these fields.
  const [featureFilters, setFeatureFilters] = useState(EMPTY_FEATURE_FILTERS)
  const visibleFeatures = useMemo(
    () => filterFeatures(features, featureFilters, currentUserId),
    [features, featureFilters, currentUserId],
  )

  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) || 'board')
  const switchView = (v) => { setView(v); localStorage.setItem(VIEW_KEY, v) }

  // Open a feature's detail panel INLINE on this page (do not navigate to My
  // Tasks). activeTask is read live from the tasks context so panel edits flow
  // back in.
  const [activeTaskId, setActiveTaskId] = useState(null)
  const activeTask = activeTaskId ? (tasks.find(t => t.id === activeTaskId) ?? null) : null

  // Request edit modal (add notes / status) + promote-to-feature flow.
  const [editingRequest, setEditingRequest] = useState(null)
  async function handlePromote(request, assigneeId) {
    const task = await requests.promote(request, { columnId: columns[0]?.id || null, assigneeId })
    if (task) { setEditingRequest(null); setActiveTaskId(task.id) }  // open the new feature's setup panel on the right
  }

  // Bug edit modal + promote-to-fix-task flow.
  const [editingBug, setEditingBug] = useState(null)
  async function handlePromoteBug(bug, assigneeId) {
    const task = await bugs.promote(bug, { columnId: columns[0]?.id || null, assigneeId })
    if (task) { setEditingBug(null); setActiveTaskId(task.id) }
  }

  const isAdmin = project?.my_role === 'owner' || project?.my_role === 'admin'
  const overall = useMemo(
    () => projectProgress(features.map(f => ({ pct: featureProgress(f).pct }))),
    [features],
  )
  const firstColumnId = columns[0]?.id || null

  if (projectsLoading && !project) return <LoadingScreen />

  if (!project) {
    return (
      <PageTransition>
        <div className="p-6">
          <EmptyState
            icon="🔒"
            title="Project not available"
            description="It may have been deleted, or you're not a member."
            action={<button onClick={() => navigate('/projects')} className="btn-primary">Back to Projects</button>}
          />
        </div>
      </PageTransition>
    )
  }

  const viewToggle = (
    <div className="inline-flex rounded-lg bg-slate-100 dark:bg-dark-hover p-0.5 gap-0.5">
      <button
        onClick={() => switchView('list')}
        className={`p-1.5 rounded-md transition-all ${view === 'list' ? 'bg-white dark:bg-dark-card text-slate-900 dark:text-white shadow-soft' : 'text-slate-400 dark:text-slate-500'}`}
        title="List view"
      >
        <List size={16} />
      </button>
      <button
        onClick={() => switchView('board')}
        className={`p-1.5 rounded-md transition-all ${view === 'board' ? 'bg-white dark:bg-dark-card text-slate-900 dark:text-white shadow-soft' : 'text-slate-400 dark:text-slate-500'}`}
        title="Board view"
      >
        <Columns3 size={16} />
      </button>
    </div>
  )

  return (
    <PageTransition>
      <div>
        {/* Header */}
        <div className="px-4 sm:px-6 pt-5 pb-3 border-b border-slate-100 dark:border-dark-border">
          <button onClick={() => navigate('/projects')} className="text-xs text-slate-400 hover:text-brand-500 inline-flex items-center gap-1 mb-2">
            <ArrowLeft size={13} /> Dev Projects
          </button>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white truncate">{project.name}</h1>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS_STYLES[project.status] || STATUS_STYLES.Active}`}>{project.status}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
                <span>{features.length} feature{features.length !== 1 ? 's' : ''} · {overall}% complete</span>
                <button onClick={() => setShowMembers(true)} className="inline-flex items-center gap-1 hover:text-brand-500 transition-colors" title="Manage members">
                  <UsersIcon size={12} /> {members.length || project.member_count} member{(members.length || project.member_count) !== 1 ? 's' : ''}
                </button>
                {project.target_date && <span>Due {new Date(project.target_date).toLocaleDateString()}</span>}
              </div>
            </div>
            {viewToggle}
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-8">
          {/* Quick-glance roll-up across all three lanes */}
          <ProjectStats features={features} requests={requests} bugs={bugs} />

          {/* Features */}
          <section>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-3">Features</h2>
            <FeaturesFilterBar filters={featureFilters} onChange={setFeatureFilters} />
            {view === 'board' ? (
              <FeatureBoard
                columns={columns}
                columnsLoading={columnsLoading}
                features={visibleFeatures}
                isAdmin={isAdmin}
                members={members}
                currentUserId={currentUserId}
                onAddFeature={addFeature}
                onMoveFeature={moveFeature}
                onAddColumn={addColumn}
                onUpdateColumn={updateColumn}
                onDeleteColumn={deleteColumn}
                onOpenFeature={(t) => setActiveTaskId(t.id)}
              />
            ) : (
              <FeatureList
                features={visibleFeatures}
                firstColumnId={firstColumnId}
                members={members}
                currentUserId={currentUserId}
                onAddFeature={addFeature}
                onOpenFeature={(t) => setActiveTaskId(t.id)}
              />
            )}
          </section>

          {/* Feature Requests */}
          <section>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-3">Feature Requests</h2>
            {view === 'board' ? (
              <RequestBoard requests={requests} onPromote={setEditingRequest} onOpenRequest={setEditingRequest} />
            ) : (
              <RequestList requests={requests} onPromote={setEditingRequest} onOpenRequest={setEditingRequest} />
            )}
          </section>

          {/* Bugs */}
          <section>
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide mb-3">Bugs</h2>
            {view === 'board' ? (
              <BugBoard bugs={bugs} onPromote={setEditingBug} onOpenBug={setEditingBug} />
            ) : (
              <BugList bugs={bugs} onPromote={setEditingBug} onOpenBug={setEditingBug} />
            )}
          </section>
        </div>

        {editingRequest && (
          <RequestEditModal
            request={editingRequest}
            requests={requests}
            members={members}
            currentUserId={currentUserId}
            onClose={() => setEditingRequest(null)}
            onPromote={handlePromote}
          />
        )}

        {editingBug && (
          <BugEditModal
            bug={editingBug}
            bugs={bugs}
            members={members}
            currentUserId={currentUserId}
            onClose={() => setEditingBug(null)}
            onPromote={handlePromoteBug}
          />
        )}

        {showMembers && (
          <ProjectMembersModal
            projectMembers={projectMembers}
            isAdmin={isAdmin}
            currentUserId={currentUserId}
            onClose={() => setShowMembers(false)}
          />
        )}

        {activeTask && (
          <TaskDetailPanel
            task={activeTask}
            tasks={tasks}
            onClose={() => setActiveTaskId(null)}
            onUpdated={() => { refetchTasks(true); setActiveTaskId(null) }}
          />
        )}
      </div>
    </PageTransition>
  )
}
