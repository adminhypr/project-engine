import { describe, it, expect } from 'vitest'
import {
  isSubtask,
  isParent,
  getChildren,
  buildSubtaskCounts,
  anyHasSubtasks,
  applyHideSubtasksFilter,
  truncateParentLabel,
} from '../subtasks'

const tasks = [
  { id: 'p1', title: 'Parent A', status: 'In Progress', parent_task_id: null },
  { id: 'c1', title: 'Child A1', status: 'Done',         parent_task_id: 'p1' },
  { id: 'c2', title: 'Child A2', status: 'In Progress',  parent_task_id: 'p1' },
  { id: 'p2', title: 'Parent B', status: 'Not Started',  parent_task_id: null },
  { id: 'solo', title: 'No kids',  status: 'In Progress', parent_task_id: null },
]

describe('isSubtask / isParent', () => {
  it('isSubtask is true only when parent_task_id is set', () => {
    expect(isSubtask(tasks[0])).toBe(false)
    expect(isSubtask(tasks[1])).toBe(true)
    expect(isSubtask(null)).toBe(false)
  })

  it('isParent is true when at least one task points at it', () => {
    expect(isParent(tasks[0], tasks)).toBe(true)
    expect(isParent(tasks[3], tasks)).toBe(false)
    expect(isParent(tasks[4], tasks)).toBe(false)
  })
})

describe('getChildren', () => {
  it('returns rows whose parent_task_id matches', () => {
    expect(getChildren('p1', tasks).map(t => t.id)).toEqual(['c1', 'c2'])
    expect(getChildren('p2', tasks)).toEqual([])
    expect(getChildren(null, tasks)).toEqual([])
  })
})

describe('buildSubtaskCounts', () => {
  it('counts total + open per parent', () => {
    const m = buildSubtaskCounts(tasks)
    expect(m.get('p1')).toEqual({ total: 2, open: 1 })
    expect(m.has('p2')).toBe(false)
  })

  it('handles empty input', () => {
    expect(buildSubtaskCounts([]).size).toBe(0)
    expect(buildSubtaskCounts(null).size).toBe(0)
  })
})

describe('anyHasSubtasks', () => {
  it('true when any task has parent_task_id', () => {
    expect(anyHasSubtasks(tasks)).toBe(true)
    expect(anyHasSubtasks([tasks[0], tasks[3]])).toBe(false)
    expect(anyHasSubtasks([])).toBe(false)
  })
})

describe('applyHideSubtasksFilter', () => {
  it('strips children when hide=true', () => {
    expect(applyHideSubtasksFilter(tasks, true).map(t => t.id))
      .toEqual(['p1', 'p2', 'solo'])
  })

  it('passes through when hide=false', () => {
    expect(applyHideSubtasksFilter(tasks, false)).toBe(tasks)
  })
})

describe('truncateParentLabel', () => {
  it('keeps short titles intact', () => {
    expect(truncateParentLabel('Short')).toBe('Short')
  })

  it('trims long titles to N-1 chars + ellipsis', () => {
    const long = 'A title that is way longer than the truncation cutoff'
    const out = truncateParentLabel(long, 24)
    expect(out.length).toBeLessThanOrEqual(24)
    expect(out.endsWith('…')).toBe(true)
  })

  it('returns empty string when title is falsy', () => {
    expect(truncateParentLabel(null)).toBe('')
    expect(truncateParentLabel('')).toBe('')
  })
})
