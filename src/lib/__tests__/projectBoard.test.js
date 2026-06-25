import { describe, it, expect } from 'vitest'
import {
  fractionalPos,
  featureProgress,
  projectProgress,
  groupFeaturesByColumn,
  groupRequestsByStatus,
  REQUEST_STATUSES,
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
