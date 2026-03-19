export function getPriority(task) {
  const now = new Date()

  if (task.due_date) {
    const due  = new Date(task.due_date)
    const diff = due - now
    const hrs  = diff / 36e5
    if (diff < 0)  return 'red'
    if (hrs < 12)  return 'orange'
    if (hrs < 24)  return 'yellow'
    return 'green'
  }

  if (task.last_updated) {
    const hrs = (now - new Date(task.last_updated)) / 36e5
    if (hrs > 36) return 'red'
    if (hrs > 24) return 'orange'
    if (hrs > 12) return 'yellow'
    return 'green'
  }

  return 'none'
}

export const PRIORITY_LABELS = {
  red:    'Overdue / Inactive',
  orange: 'Urgent',
  yellow: 'Due Soon',
  green:  'On Track',
  none:   'No Date Set'
}

export const PRIORITY_COLORS = {
  red:    { row: 'bg-red-500/10 border-l-4 border-l-red-500',    badge: 'bg-red-500/15 text-red-700 backdrop-blur-sm' },
  orange: { row: 'bg-orange-500/10 border-l-4 border-l-orange-500', badge: 'bg-orange-500/15 text-orange-700 backdrop-blur-sm' },
  yellow: { row: 'bg-yellow-500/10 border-l-4 border-l-yellow-500', badge: 'bg-yellow-500/15 text-yellow-700 backdrop-blur-sm' },
  green:  { row: 'bg-emerald-500/10 border-l-4 border-l-emerald-500',  badge: 'bg-emerald-500/15 text-emerald-700 backdrop-blur-sm' },
  none:   { row: '',                                             badge: 'bg-navy-50 text-navy-500' }
}
