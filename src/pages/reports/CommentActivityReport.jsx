import { formatDateShort } from '../../lib/helpers'
import ExportBtn from './ExportBtn'

export default function CommentActivityReport({ tasks, comments, profiles }) {
  const byPerson = profiles.map(p => {
    const mine = comments.filter(c => c.author_id === p.id)
    const taskIds = [...new Set(mine.map(c => c.task_id))]
    return {
      name:          p.full_name,
      team:          p.teams?.name || '—',
      comments:      mine.length,
      tasksCommented: taskIds.length,
      avgPerTask:    taskIds.length ? (mine.length / taskIds.length).toFixed(1) : 0
    }
  }).filter(r => r.comments > 0).sort((a, b) => b.comments - a.comments)

  const byTask = tasks.map(t => ({
    ...t,
    commentCount: comments.filter(c => c.task_id === t.id).length
  })).sort((a, b) => b.commentCount - a.commentCount).slice(0, 10)

  const zeroCommentTasks = tasks.filter(t =>
    !comments.find(c => c.task_id === t.id) && t.status !== 'Done'
  )

  return (
    <div className="space-y-5">
      <ExportBtn data={byPerson} filename="comment-activity.csv" />

      <div className="card">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Comment Activity by Person</p>
        <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="table-th">Person</th>
            <th className="table-th">Team</th>
            <th className="table-th text-center">Comments Posted</th>
            <th className="table-th text-center">Tasks Commented On</th>
            <th className="table-th text-center">Avg per Task</th>
          </tr></thead>
          <tbody>
            {byPerson.map(r => (
              <tr key={r.name} className="border-b border-slate-100 dark:border-dark-border">
                <td className="table-td font-medium">{r.name}</td>
                <td className="table-td text-slate-500 dark:text-slate-400">{r.team}</td>
                <td className="table-td text-center font-semibold">{r.comments}</td>
                <td className="table-td text-center">{r.tasksCommented}</td>
                <td className="table-td text-center">{r.avgPerTask}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="card">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Most Discussed Tasks (Top 10)</p>
        <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="w-full text-sm">
          <thead><tr>
            <th className="table-th">Task</th>
            <th className="table-th">Assigned To</th>
            <th className="table-th text-center">Comments</th>
          </tr></thead>
          <tbody>
            {byTask.filter(t => t.commentCount > 0).map(t => (
              <tr key={t.id} className="border-b border-slate-100 dark:border-dark-border">
                <td className="table-td font-medium">{t.title}</td>
                <td className="table-td text-slate-500 dark:text-slate-400">{t.assignee?.full_name}</td>
                <td className="table-td text-center font-semibold text-brand-500">💬 {t.commentCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <div className="card">
        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">
          Silent Tasks — No Comments ({zeroCommentTasks.length})
        </p>
        {zeroCommentTasks.length === 0
          ? <p className="text-sm text-slate-400 dark:text-slate-500">All active tasks have at least one comment.</p>
          : <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm">
              <thead><tr>
                <th className="table-th">Task</th>
                <th className="table-th">Assigned To</th>
                <th className="table-th">Status</th>
                <th className="table-th">Date Assigned</th>
              </tr></thead>
              <tbody>
                {zeroCommentTasks.slice(0, 20).map(t => (
                  <tr key={t.id} className="border-b border-slate-100 dark:border-dark-border">
                    <td className="table-td font-medium">{t.title}</td>
                    <td className="table-td text-slate-500 dark:text-slate-400">{t.assignee?.full_name}</td>
                    <td className="table-td">{t.status}</td>
                    <td className="table-td text-xs text-slate-400 dark:text-slate-500">{formatDateShort(t.date_assigned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
        }
      </div>
    </div>
  )
}
