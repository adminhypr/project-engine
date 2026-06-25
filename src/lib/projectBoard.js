// Pure helpers for the Trello-style project dev board. Kept out of the
// components so the board math (fractional ordering, % completion, grouping)
// is unit-tested. See docs/plans/2026-06-25-project-dev-board-design.md.

// Base gap for fractional positioning. A drag rewrites only the moved row's
// `pos` to the midpoint of its neighbors, so the rest of the column is
// untouched (Trello's `pos` float trick).
const POS_STEP = 1000

// Canonical Feature Request statuses, in board (left→right) order.
export const REQUEST_STATUSES = [
  'Requested',
  'Under Review',
  'Planned',
  'Rejected',
  'Promoted',
]

// New fractional position for a card dropped between `before` and `after`
// (either may be null at the ends of a column / an empty column).
export function fractionalPos(before, after) {
  const hasBefore = typeof before === 'number'
  const hasAfter = typeof after === 'number'
  if (hasBefore && hasAfter) return (before + after) / 2
  if (!hasBefore && hasAfter) return after / 2           // dropped at the top
  if (hasBefore && !hasAfter) return before + POS_STEP   // dropped at the bottom
  return POS_STEP                                         // empty column
}

// % completion for a Feature (= a task). Prefer sub-tasks done/total; when a
// feature has no sub-tasks, fall back to status (Done = 100, Not Started = 0,
// anything mid-flight = null → render a dash, not a misleading number).
export function featureProgress(task) {
  const total = Number(task?.subtask_count) || 0
  const open = Number(task?.open_subtask_count) || 0
  if (total > 0) {
    const done = Math.max(0, total - open)
    return { pct: Math.round((done / total) * 100), done, total, fromSubtasks: true }
  }
  const status = task?.status
  const pct = status === 'Done' ? 100 : status === 'Not Started' ? 0 : null
  return { pct, done: 0, total: 0, fromSubtasks: false }
}

// Overall project progress = average of feature pcts (a null pct — an
// in-flight feature with no sub-tasks — counts as 0 toward the rollup).
export function projectProgress(features) {
  const list = features || []
  if (list.length === 0) return 0
  const sum = list.reduce((acc, f) => acc + (typeof f?.pct === 'number' ? f.pct : 0), 0)
  return Math.round(sum / list.length)
}

const byPos = (a, b) => (a?.project_pos ?? 0) - (b?.project_pos ?? 0)

// Group features into their board columns. Columns are returned ordered by
// `pos`; each column's cards are ordered by `project_pos`. Features whose
// column isn't on the board (orphans) are dropped from the board view (they
// still show in the list view).
export function groupFeaturesByColumn(features, columns) {
  const cols = [...(columns || [])].sort((a, b) => (a?.pos ?? 0) - (b?.pos ?? 0))
  const feats = features || []
  return cols.map(column => ({
    column,
    cards: feats.filter(f => f?.project_column_id === column.id).sort(byPos),
  }))
}

// Bucket feature requests into the 5 canonical statuses (always all 5, in
// order), each sorted by `pos`.
export function groupRequestsByStatus(requests) {
  const list = requests || []
  return REQUEST_STATUSES.map(status => ({
    status,
    requests: list
      .filter(r => r?.status === status)
      .sort((a, b) => (a?.pos ?? 0) - (b?.pos ?? 0)),
  }))
}

// Canonical bug statuses, in board (left→right) order. Terminal: Won't Fix /
// Promoted (the fixing lifecycle lives on the promoted task, not the bug).
export const BUG_STATUSES = ['Reported', 'Confirmed', "Won't Fix", 'Promoted']

// Severity levels, highest→lowest.
export const BUG_SEVERITIES = ['Critical', 'High', 'Medium', 'Low']

// Map a bug severity to the urgency of the task it promotes into. tasks.urgency
// allows 'Urgent' since migration 087.
const SEV_TO_URGENCY = { Critical: 'Urgent', High: 'High', Medium: 'Med', Low: 'Low' }
export function severityToUrgency(sev) {
  return SEV_TO_URGENCY[sev] || 'Med'
}

// Bucket bugs into the 4 canonical statuses (always all 4, in order), each
// sorted by `pos`. Mirrors groupRequestsByStatus.
export function groupBugsByStatus(bugs) {
  const list = bugs || []
  return BUG_STATUSES.map(status => ({
    status,
    bugs: list
      .filter(b => b?.status === status)
      .sort((a, b) => (a?.pos ?? 0) - (b?.pos ?? 0)),
  }))
}

// Urgency levels offered in the Features filter (board card values).
export const FEATURE_URGENCIES = ['Urgent', 'High', 'Med', 'Low']

// Default (empty) filter state for the Features board.
export const EMPTY_FEATURE_FILTERS = { mine: false, urgencies: [], due: 'any' }

// True when any Features filter is narrowing the set.
export function hasActiveFeatureFilter(filters) {
  const f = filters || {}
  return !!(f.mine || (f.urgencies?.length || 0) > 0 || (f.due && f.due !== 'any'))
}

// Is the current user one of a feature's assignees (primary or secondary)?
function isAssignedTo(feature, userId) {
  if (!userId) return false
  if (feature?.assigned_to === userId) return true
  return (feature?.assignees || []).some(a => a?.id === userId)
}

// Parse a task due_date as LOCAL midnight. due_date is a date-only string
// ('YYYY-MM-DD'); `new Date('YYYY-MM-DD')` parses as UTC midnight, which in
// negative-UTC timezones lands on the previous local day and skews the
// overdue/week buckets by one. Build from local Y/M/D instead.
function parseDueLocal(s) {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return new Date(s)  // full timestamp — leave as-is
}

// Filter Features (= tasks) for the board/list by the lightweight project
// filters: mine (assigned to me), urgencies (empty = all), and a due bucket
// (any | overdue | week | none). `now` is injectable for deterministic tests.
export function filterFeatures(features, filters = {}, currentUserId = null, now = new Date()) {
  const { mine = false, urgencies = [], due = 'any' } = filters || {}
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0)
  const weekAhead = new Date(startOfToday); weekAhead.setDate(weekAhead.getDate() + 7)

  return (features || []).filter(f => {
    if (mine && !isAssignedTo(f, currentUserId)) return false
    if (urgencies.length && !urgencies.includes(f?.urgency)) return false
    if (due !== 'any') {
      const d = parseDueLocal(f?.due_date)
      if (due === 'none') { if (d) return false }
      else if (due === 'overdue') { if (!(d && f?.status !== 'Done' && d < now)) return false }
      else if (due === 'week') { if (!(d && d >= startOfToday && d <= weekAhead)) return false }
    }
    return true
  })
}
