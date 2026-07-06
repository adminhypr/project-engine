// Which task properties show on calendar cards — Notion's "Property
// visibility" equivalent. Persisted globally in localStorage (same pattern
// as pe-theme / pe-task-view). Default = none, matching the original
// minimal title-only pill.

export const STORAGE_KEY = 'pe-calendar-props'

export const CALENDAR_PROPS = [
  { key: 'status',   label: 'Status' },
  { key: 'urgency',  label: 'Urgency' },
  { key: 'assignee', label: 'Assignee' },
  { key: 'team',     label: 'Team' },
  { key: 'task_id',  label: 'Task ID' },
  { key: 'due_time', label: 'Due time' },
]

const VALID = new Set(CALENDAR_PROPS.map(p => p.key))

export function loadCalendarProps() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(k => VALID.has(k))
  } catch {
    return []
  }
}

export function saveCalendarProps(keys) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify((keys || []).filter(k => VALID.has(k))))
  } catch { /* storage full/blocked — view still works, just not persisted */ }
}
