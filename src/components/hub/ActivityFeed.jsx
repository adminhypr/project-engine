import { useHubActivity } from '../../hooks/useHubActivity'
import { FadeIn, StaggerChildren, StaggerItem } from '../ui/animations'
import { Spinner } from '../ui/index'
import ActivityItem from './ActivityItem'

export default function ActivityFeed({ hubId }) {
  const { activities, loading, loadMore, hasMore } = useHubActivity(hubId)

  if (loading) return <div className="py-8 flex justify-center"><Spinner /></div>

  if (activities.length === 0) {
    return (
      <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-6">
        No activity yet. Actions across the hub will show up here.
      </p>
    )
  }

  // Group by date
  const grouped = {}
  activities.forEach(a => {
    const day = new Date(a.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    if (!grouped[day]) grouped[day] = []
    grouped[day].push(a)
  })

  return (
    <div className="space-y-4">
      {Object.entries(grouped).map(([day, items]) => (
        <div key={day}>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{day}</span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-dark-border" />
          </div>
          <StaggerChildren className="space-y-1">
            {items.map(item => (
              <StaggerItem key={item.id}>
                <ActivityItem item={item} />
              </StaggerItem>
            ))}
          </StaggerChildren>
        </div>
      ))}
      {hasMore && (
        <button onClick={loadMore} className="btn btn-ghost text-xs w-full">
          Load more
        </button>
      )}
    </div>
  )
}
