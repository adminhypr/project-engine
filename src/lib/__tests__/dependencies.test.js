import { describe, it, expect } from 'vitest'
import {
  getOpenBlockers,
  hasOpenBlockers,
  buildExcludedPickerIds,
  shouldWarnOnStatusChange,
} from '../dependencies'

const tasks = [
  { id: 'a', status: 'In Progress' },
  { id: 'b', status: 'Done' },
  { id: 'c', status: 'Not Started' },
]
const taskById = new Map(tasks.map(t => [t.id, t]))

describe('getOpenBlockers', () => {
  it('returns blocker rows whose linked task is not Done', () => {
    const rows = [{ blocker_id: 'a' }, { blocker_id: 'b' }, { blocker_id: 'c' }]
    expect(getOpenBlockers(rows, taskById).map(t => t.id)).toEqual(['a', 'c'])
  })

  it('skips rows whose blocker isn\'t in the lookup (e.g. RLS-hidden)', () => {
    const rows = [{ blocker_id: 'missing' }, { blocker_id: 'a' }]
    expect(getOpenBlockers(rows, taskById).map(t => t.id)).toEqual(['a'])
  })

  it('handles empty/null inputs', () => {
    expect(getOpenBlockers([], taskById)).toEqual([])
    expect(getOpenBlockers(null, taskById)).toEqual([])
    expect(getOpenBlockers([{ blocker_id: 'a' }], null)).toEqual([])
  })
})

describe('hasOpenBlockers', () => {
  it('true when at least one open blocker', () => {
    expect(hasOpenBlockers([{ blocker_id: 'a' }], taskById)).toBe(true)
  })

  it('false when all blockers are Done', () => {
    expect(hasOpenBlockers([{ blocker_id: 'b' }], taskById)).toBe(false)
  })

  it('false on empty input', () => {
    expect(hasOpenBlockers([], taskById)).toBe(false)
  })
})

describe('buildExcludedPickerIds', () => {
  it('excludes self, existing blockers, and Done tasks', () => {
    const excl = buildExcludedPickerIds({
      selfId: 'a',
      existingBlockerIds: ['c'],
      allTasks: tasks,
    })
    expect(excl.has('a')).toBe(true) // self
    expect(excl.has('b')).toBe(true) // Done
    expect(excl.has('c')).toBe(true) // already linked
  })

  it('handles missing inputs gracefully', () => {
    const excl = buildExcludedPickerIds({})
    expect(excl.size).toBe(0)
  })
})

describe('shouldWarnOnStatusChange', () => {
  it('warns when moving to In Progress with open blockers', () => {
    expect(shouldWarnOnStatusChange('Not Started', 'In Progress', 1)).toBe(true)
  })

  it('warns when moving to Done with open blockers', () => {
    expect(shouldWarnOnStatusChange('In Progress', 'Done', 2)).toBe(true)
  })

  it('does not warn when moving to Blocked (already paused)', () => {
    expect(shouldWarnOnStatusChange('In Progress', 'Blocked', 1)).toBe(false)
  })

  it('does not warn when there are no open blockers', () => {
    expect(shouldWarnOnStatusChange('Not Started', 'In Progress', 0)).toBe(false)
  })

  it('does not warn when status didn\'t actually change', () => {
    expect(shouldWarnOnStatusChange('In Progress', 'In Progress', 1)).toBe(false)
  })
})
