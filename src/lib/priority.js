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
  red:    { row: 'bg-red-50 border-l-3 border-l-red-500',    badge: 'bg-red-50 text-red-700' },
  orange: { row: 'bg-orange-50 border-l-3 border-l-orange-500', badge: 'bg-orange-50 text-orange-700' },
  yellow: { row: 'bg-yellow-50 border-l-3 border-l-yellow-500', badge: 'bg-yellow-50 text-yellow-700' },
  green:  { row: 'bg-emerald-50 border-l-3 border-l-emerald-500',  badge: 'bg-emerald-50 text-emerald-700' },
  none:   { row: '',                                             badge: 'bg-slate-100 text-slate-500' }
}
