import { describe, it, expect } from 'vitest'
import { splitByArchived } from '../archive'

describe('splitByArchived', () => {
  it('partitions tasks by the archived flag', () => {
    const tasks = [
      { id: 'a', archived: false },
      { id: 'b', archived: true },
      { id: 'c' },               // missing flag → active
      { id: 'd', archived: true },
    ]
    const { active, archived } = splitByArchived(tasks)
    expect(active.map(t => t.id)).toEqual(['a', 'c'])
    expect(archived.map(t => t.id)).toEqual(['b', 'd'])
  })

  it('preserves input order within each partition', () => {
    const tasks = [
      { id: '1', archived: true },
      { id: '2', archived: false },
      { id: '3', archived: true },
    ]
    const { active, archived } = splitByArchived(tasks)
    expect(archived.map(t => t.id)).toEqual(['1', '3'])
    expect(active.map(t => t.id)).toEqual(['2'])
  })

  it('handles null / undefined / empty input', () => {
    expect(splitByArchived(null)).toEqual({ active: [], archived: [] })
    expect(splitByArchived(undefined)).toEqual({ active: [], archived: [] })
    expect(splitByArchived([])).toEqual({ active: [], archived: [] })
  })

  it('does not mutate the input array', () => {
    const tasks = [{ id: 'a', archived: true }]
    const copy = [...tasks]
    splitByArchived(tasks)
    expect(tasks).toEqual(copy)
  })
})
