import { describe, it, expect } from 'vitest'
import { groupCardsByColumn, sortCards } from '../cards'

describe('sortCards', () => {
  it('sorts by position ascending, id breaks ties', () => {
    const arr = [
      { id: 'b', position: 1 },
      { id: 'a', position: 1 },
      { id: 'c', position: 0 },
    ]
    expect(sortCards(arr).map(x => x.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('groupCardsByColumn', () => {
  it('groups by column_id, preserves per-column position order', () => {
    const cards = [
      { id: 'c1', column_id: 'col-a', position: 1 },
      { id: 'c2', column_id: 'col-b', position: 0 },
      { id: 'c3', column_id: 'col-a', position: 0 },
    ]
    const result = groupCardsByColumn(cards, ['col-a', 'col-b'])
    expect(result['col-a'].map(c => c.id)).toEqual(['c3', 'c1'])
    expect(result['col-b'].map(c => c.id)).toEqual(['c2'])
  })

  it('returns empty array for columns with no cards', () => {
    const result = groupCardsByColumn([], ['col-a'])
    expect(result['col-a']).toEqual([])
  })
})
