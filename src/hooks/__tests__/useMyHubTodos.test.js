import { describe, it, expect, vi, beforeEach } from 'vitest'
import { groupTodosByHub, filterTodosByStatus, filterTodosByDue } from '../../lib/myTodos'

describe('groupTodosByHub', () => {
  it('groups items by hub.id preserving hub name + list hierarchy', () => {
    const items = [
      { id: '1', title: 'A', hub_id: 'h1', hub: { id: 'h1', name: 'Hub One' }, list: { id: 'l1', title: 'List 1' } },
      { id: '2', title: 'B', hub_id: 'h1', hub: { id: 'h1', name: 'Hub One' }, list: { id: 'l1', title: 'List 1' } },
      { id: '3', title: 'C', hub_id: 'h2', hub: { id: 'h2', name: 'Hub Two' }, list: { id: 'l2', title: 'List 2' } },
    ]
    const grouped = groupTodosByHub(items)
    expect(grouped).toHaveLength(2)
    expect(grouped[0].hub.id).toBe('h1')
    expect(grouped[0].lists[0].items).toHaveLength(2)
  })

  it('returns empty array for no items', () => {
    expect(groupTodosByHub([])).toEqual([])
  })
})

describe('filterTodosByStatus', () => {
  const items = [
    { id: '1', completed_at: null },
    { id: '2', completed_at: '2026-04-20T00:00:00Z' },
  ]
  it('"all" returns everything', () => {
    expect(filterTodosByStatus(items, 'all')).toHaveLength(2)
  })
  it('"open" excludes completed', () => {
    const r = filterTodosByStatus(items, 'open')
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('1')
  })
  it('"completed" excludes open', () => {
    const r = filterTodosByStatus(items, 'completed')
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('2')
  })
})

describe('filterTodosByDue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-21T12:00:00Z'))
  })
  const items = [
    { id: 'overdue',  due_date: '2026-04-20T00:00:00Z' },
    { id: 'thisweek', due_date: '2026-04-24T00:00:00Z' },
    { id: 'later',    due_date: '2026-05-15T00:00:00Z' },
    { id: 'nodate',   due_date: null },
  ]
  it('"overdue" returns past-due only', () => {
    expect(filterTodosByDue(items, 'overdue').map(i => i.id)).toEqual(['overdue'])
  })
  it('"week" returns items due in next 7 days (inclusive of overdue? no)', () => {
    expect(filterTodosByDue(items, 'week').map(i => i.id)).toEqual(['thisweek'])
  })
  it('"none" returns items without a due date', () => {
    expect(filterTodosByDue(items, 'none').map(i => i.id)).toEqual(['nodate'])
  })
  it('"all" returns everything', () => {
    expect(filterTodosByDue(items, 'all')).toHaveLength(4)
  })
})
