import { describe, it, expect } from 'vitest'
import {
  fractionalPos,
  featureProgress,
  projectProgress,
  groupFeaturesByColumn,
  groupRequestsByStatus,
  REQUEST_STATUSES,
  BUG_STATUSES,
  BUG_SEVERITIES,
  severityToUrgency,
  groupBugsByStatus,
  filterFeatures,
  hasActiveFeatureFilter,
  EMPTY_FEATURE_FILTERS,
  projectStats,
} from '../projectBoard'

describe('fractionalPos', () => {
  it('returns the midpoint between two positions', () => {
    expect(fractionalPos(1000, 2000)).toBe(1500)
  })
  it('inserts at the start (no before) → half of after', () => {
    expect(fractionalPos(null, 2000)).toBe(1000)
  })
  it('inserts at the end (no after) → before + step', () => {
    expect(fractionalPos(1000, null)).toBe(2000)
  })
  it('empty column → base step', () => {
    expect(fractionalPos(null, null)).toBe(1000)
  })
})

describe('featureProgress', () => {
  it('computes pct from sub-tasks (done / total)', () => {
    const p = featureProgress({ subtask_count: 4, open_subtask_count: 1 })
    expect(p).toEqual({ pct: 75, done: 3, total: 4, fromSubtasks: true })
  })
  it('all sub-tasks done → 100%', () => {
    expect(featureProgress({ subtask_count: 3, open_subtask_count: 0 }).pct).toBe(100)
  })
  it('no sub-tasks, status Done → 100%', () => {
    expect(featureProgress({ subtask_count: 0, status: 'Done' })).toEqual(
      { pct: 100, done: 0, total: 0, fromSubtasks: false },
    )
  })
  it('no sub-tasks, status Not Started → 0%', () => {
    expect(featureProgress({ subtask_count: 0, status: 'Not Started' }).pct).toBe(0)
  })
  it('no sub-tasks, In Progress → null (show a dash)', () => {
    expect(featureProgress({ subtask_count: 0, status: 'In Progress' }).pct).toBe(null)
  })
  it('no sub-tasks, Blocked → null', () => {
    expect(featureProgress({ subtask_count: 0, status: 'Blocked' }).pct).toBe(null)
  })
  it('tolerates missing fields', () => {
    expect(featureProgress({}).pct).toBe(null)
    expect(featureProgress(null).pct).toBe(null)
  })
})

describe('projectProgress', () => {
  it('averages feature pcts, rounded', () => {
    expect(projectProgress([{ pct: 100 }, { pct: 50 }])).toBe(75)
  })
  it('treats null pct as 0', () => {
    expect(projectProgress([{ pct: 100 }, { pct: null }])).toBe(50)
  })
  it('empty → 0', () => {
    expect(projectProgress([])).toBe(0)
    expect(projectProgress(null)).toBe(0)
  })
})

describe('groupFeaturesByColumn', () => {
  it('orders columns by pos and cards by project_pos', () => {
    const columns = [
      { id: 'c2', pos: 2000 },
      { id: 'c1', pos: 1000 },
    ]
    const features = [
      { id: 'f3', project_column_id: 'c2', project_pos: 1000 },
      { id: 'f1', project_column_id: 'c1', project_pos: 2000 },
      { id: 'f2', project_column_id: 'c1', project_pos: 1000 },
    ]
    const result = groupFeaturesByColumn(features, columns)
    expect(result.map(g => g.column.id)).toEqual(['c1', 'c2'])
    expect(result[0].cards.map(c => c.id)).toEqual(['f2', 'f1'])
    expect(result[1].cards.map(c => c.id)).toEqual(['f3'])
  })
  it('drops features whose column is not on the board', () => {
    const columns = [{ id: 'c1', pos: 1000 }]
    const features = [{ id: 'f1', project_column_id: 'orphan', project_pos: 1 }]
    const result = groupFeaturesByColumn(features, columns)
    expect(result[0].cards).toEqual([])
  })
  it('handles empty inputs', () => {
    expect(groupFeaturesByColumn(null, null)).toEqual([])
  })
})

describe('groupRequestsByStatus', () => {
  it('buckets requests into the 5 canonical statuses in order', () => {
    const requests = [
      { id: 'r1', status: 'Planned', pos: 2000 },
      { id: 'r2', status: 'Requested', pos: 1000 },
      { id: 'r3', status: 'Planned', pos: 1000 },
    ]
    const result = groupRequestsByStatus(requests)
    expect(result.map(g => g.status)).toEqual(REQUEST_STATUSES)
    const planned = result.find(g => g.status === 'Planned')
    expect(planned.requests.map(r => r.id)).toEqual(['r3', 'r1'])
    expect(result.find(g => g.status === 'Requested').requests.map(r => r.id)).toEqual(['r2'])
    expect(result.find(g => g.status === 'Rejected').requests).toEqual([])
  })
  it('handles empty input', () => {
    const result = groupRequestsByStatus(null)
    expect(result.map(g => g.status)).toEqual(REQUEST_STATUSES)
    expect(result.every(g => g.requests.length === 0)).toBe(true)
  })
})

describe('severityToUrgency', () => {
  it('maps each severity to a task urgency', () => {
    expect(severityToUrgency('Critical')).toBe('Urgent')
    expect(severityToUrgency('High')).toBe('High')
    expect(severityToUrgency('Medium')).toBe('Med')
    expect(severityToUrgency('Low')).toBe('Low')
  })
  it('falls back to Med for unknown/empty severity', () => {
    expect(severityToUrgency(undefined)).toBe('Med')
    expect(severityToUrgency('Nonsense')).toBe('Med')
  })
})

describe('groupBugsByStatus', () => {
  it('returns all 4 statuses in board order, each sorted by pos', () => {
    const bugs = [
      { id: 'a', status: 'Reported', pos: 2000 },
      { id: 'b', status: 'Reported', pos: 1000 },
      { id: 'c', status: 'Confirmed', pos: 1000 },
      { id: 'd', status: 'Promoted', pos: 1000 },
    ]
    const groups = groupBugsByStatus(bugs)
    expect(groups.map(g => g.status)).toEqual(BUG_STATUSES)
    expect(groups[0].bugs.map(b => b.id)).toEqual(['b', 'a']) // Reported, sorted by pos
    expect(groups[1].bugs.map(b => b.id)).toEqual(['c'])      // Confirmed
    expect(groups.find(g => g.status === "Won't Fix").bugs).toEqual([]) // empty kept
  })
  it('handles null/empty input', () => {
    expect(groupBugsByStatus(null).every(g => g.bugs.length === 0)).toBe(true)
  })
})

describe('hasActiveFeatureFilter', () => {
  it('is false for the empty filter', () => {
    expect(hasActiveFeatureFilter(EMPTY_FEATURE_FILTERS)).toBe(false)
    expect(hasActiveFeatureFilter(null)).toBe(false)
  })
  it('is true when any dimension is set', () => {
    expect(hasActiveFeatureFilter({ mine: true, urgencies: [], due: 'any' })).toBe(true)
    expect(hasActiveFeatureFilter({ mine: false, urgencies: ['High'], due: 'any' })).toBe(true)
    expect(hasActiveFeatureFilter({ mine: false, urgencies: [], due: 'overdue' })).toBe(true)
  })
})

describe('projectStats', () => {
  const now = new Date('2026-06-25T12:00:00Z')
  const feats = [
    { status: 'Done',        subtask_count: 2, open_subtask_count: 0, due_date: '2026-06-20' }, // 100
    { status: 'In Progress', due_date: '2026-06-20' },                                          // overdue, pct null->0
    { status: 'In Progress', due_date: '2026-07-10' },                                          // pct null->0
    { status: 'Not Started', due_date: null },                                                  // pct 0
  ]
  const requests = [
    { status: 'Requested' }, { status: 'Under Review' }, { status: 'Planned' },
    { status: 'Promoted' }, { status: 'Rejected' },
  ]
  const bugs = [
    { status: 'Reported', severity: 'Critical' },
    { status: 'Confirmed', severity: 'Low' },
    { status: 'Reported', severity: 'High' },
    { status: "Won't Fix", severity: 'Critical' },
    { status: 'Promoted', severity: 'High' },
  ]

  it('rolls up feature counts, progress, overdue', () => {
    const s = projectStats(feats, requests, bugs, now)
    expect(s.features).toBe(4)
    expect(s.done).toBe(1)
    expect(s.inProgress).toBe(2)
    expect(s.overdue).toBe(1)        // only the In Progress one past due (Done is excluded)
    expect(s.pct).toBe(25)           // (100 + 0 + 0 + 0) / 4
  })
  it('counts only non-terminal requests as open', () => {
    expect(projectStats(feats, requests, bugs, now).openRequests).toBe(3)
  })
  it('counts open bugs and the critical/high subset', () => {
    const s = projectStats(feats, requests, bugs, now)
    expect(s.openBugs).toBe(3)       // 2 Reported + 1 Confirmed (Won't Fix / Promoted excluded)
    expect(s.criticalBugs).toBe(2)   // Critical + High among open
  })
  it('handles empty / null input', () => {
    const s = projectStats(null, null, null, now)
    expect(s).toEqual({ features: 0, done: 0, inProgress: 0, overdue: 0, pct: 0, openRequests: 0, openBugs: 0, criticalBugs: 0 })
  })
})

describe('filterFeatures', () => {
  const now = new Date('2026-06-25T12:00:00Z')
  const feats = [
    { id: 'a', urgency: 'Urgent', status: 'In Progress', assigned_to: 'me',   due_date: '2026-06-20' }, // overdue, mine
    { id: 'b', urgency: 'Med',    status: 'Not Started', assigned_to: 'you',  assignees: [{ id: 'me' }], due_date: '2026-06-27' }, // due this week, mine (secondary)
    { id: 'c', urgency: 'Low',    status: 'Not Started', assigned_to: 'you',  due_date: null },          // no due, not mine
    { id: 'd', urgency: 'High',   status: 'Done',        assigned_to: 'you',  due_date: '2026-06-20' },  // past due but Done -> not overdue
  ]

  it('returns all with the empty filter', () => {
    expect(filterFeatures(feats, EMPTY_FEATURE_FILTERS, 'me', now).map(f => f.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('mine matches primary OR secondary assignee', () => {
    expect(filterFeatures(feats, { mine: true }, 'me', now).map(f => f.id)).toEqual(['a', 'b'])
  })
  it('urgencies filter is a whitelist (empty = all)', () => {
    expect(filterFeatures(feats, { urgencies: ['Urgent', 'High'] }, 'me', now).map(f => f.id)).toEqual(['a', 'd'])
  })
  it('due=overdue excludes Done tasks even when past due', () => {
    expect(filterFeatures(feats, { due: 'overdue' }, 'me', now).map(f => f.id)).toEqual(['a'])
  })
  it('due=week matches due dates within the next 7 days', () => {
    expect(filterFeatures(feats, { due: 'week' }, 'me', now).map(f => f.id)).toEqual(['b'])
  })
  it('due=none matches only features without a due date', () => {
    expect(filterFeatures(feats, { due: 'none' }, 'me', now).map(f => f.id)).toEqual(['c'])
  })
  it('combines dimensions (AND)', () => {
    expect(filterFeatures(feats, { mine: true, urgencies: ['Urgent'], due: 'overdue' }, 'me', now).map(f => f.id)).toEqual(['a'])
  })
})
