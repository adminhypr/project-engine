import { describe, it, expect } from 'vitest'
import { aggregateReactions, toggleReactionRow } from '../../lib/reactionAggregation'

describe('aggregateReactions', () => {
  it('returns an empty object for empty input', () => {
    expect(aggregateReactions([], 'me')).toEqual({})
    expect(aggregateReactions(null, 'me')).toEqual({})
    expect(aggregateReactions(undefined, 'me')).toEqual({})
  })

  it('aggregates a single reaction', () => {
    const rows = [{ message_id: 'm1', user_id: 'u1', emoji: '👍' }]
    const out = aggregateReactions(rows, 'u1')
    expect(out).toEqual({
      m1: [{ emoji: '👍', count: 1, users: ['u1'], mine: true }],
    })
  })

  it('aggregates multiple users on the same emoji', () => {
    const rows = [
      { message_id: 'm1', user_id: 'u1', emoji: '❤️' },
      { message_id: 'm1', user_id: 'u2', emoji: '❤️' },
      { message_id: 'm1', user_id: 'u3', emoji: '❤️' },
    ]
    const out = aggregateReactions(rows, 'u2')
    expect(out.m1).toHaveLength(1)
    expect(out.m1[0]).toMatchObject({
      emoji: '❤️',
      count: 3,
      mine: true,
    })
    expect(out.m1[0].users.sort()).toEqual(['u1', 'u2', 'u3'])
  })

  it('represents the same user reacting with multiple emojis as separate entries', () => {
    const rows = [
      { message_id: 'm1', user_id: 'u1', emoji: '👍' },
      { message_id: 'm1', user_id: 'u1', emoji: '🎉' },
    ]
    const out = aggregateReactions(rows, 'u1')
    expect(out.m1).toHaveLength(2)
    const byEmoji = Object.fromEntries(out.m1.map(e => [e.emoji, e]))
    expect(byEmoji['👍']).toMatchObject({ count: 1, users: ['u1'], mine: true })
    expect(byEmoji['🎉']).toMatchObject({ count: 1, users: ['u1'], mine: true })
  })

  it('sets mine=false when the current user did not react', () => {
    const rows = [
      { message_id: 'm1', user_id: 'u2', emoji: '😂' },
      { message_id: 'm1', user_id: 'u3', emoji: '😂' },
    ]
    const out = aggregateReactions(rows, 'u1')
    expect(out.m1[0].mine).toBe(false)
    expect(out.m1[0].count).toBe(2)
  })

  it('groups rows by message_id across multiple messages', () => {
    const rows = [
      { message_id: 'm1', user_id: 'u1', emoji: '👍' },
      { message_id: 'm2', user_id: 'u1', emoji: '👀' },
      { message_id: 'm1', user_id: 'u2', emoji: '👍' },
    ]
    const out = aggregateReactions(rows, 'u1')
    expect(Object.keys(out).sort()).toEqual(['m1', 'm2'])
    expect(out.m1[0].count).toBe(2)
    expect(out.m2[0]).toMatchObject({ emoji: '👀', count: 1, mine: true })
  })

  it('dedupes a duplicated (message, user, emoji) row defensively', () => {
    const rows = [
      { message_id: 'm1', user_id: 'u1', emoji: '👍' },
      { message_id: 'm1', user_id: 'u1', emoji: '👍' },
    ]
    const out = aggregateReactions(rows, 'u1')
    expect(out.m1[0].count).toBe(1)
    expect(out.m1[0].users).toEqual(['u1'])
  })

  it('ignores rows missing required fields', () => {
    const rows = [
      { message_id: 'm1', user_id: 'u1', emoji: '👍' },
      { message_id: null, user_id: 'u1', emoji: '❤️' },
      { user_id: 'u1', emoji: '❤️' },
      null,
    ]
    const out = aggregateReactions(rows, 'u1')
    expect(Object.keys(out)).toEqual(['m1'])
    expect(out.m1).toHaveLength(1)
  })
})

describe('toggleReactionRow', () => {
  it('adds a row when not present', () => {
    const out = toggleReactionRow([], 'm1', 'u1', '👍')
    expect(out).toEqual([{ message_id: 'm1', user_id: 'u1', emoji: '👍' }])
  })

  it('removes a matching row when present', () => {
    const rows = [
      { message_id: 'm1', user_id: 'u1', emoji: '👍' },
      { message_id: 'm1', user_id: 'u2', emoji: '👍' },
    ]
    const out = toggleReactionRow(rows, 'm1', 'u1', '👍')
    expect(out).toEqual([{ message_id: 'm1', user_id: 'u2', emoji: '👍' }])
  })

  it('is idempotent when toggling twice', () => {
    const rows = [{ message_id: 'm1', user_id: 'u1', emoji: '👍' }]
    const once = toggleReactionRow(rows, 'm1', 'u1', '👍')
    const twice = toggleReactionRow(once, 'm1', 'u1', '👍')
    expect(twice).toEqual(rows)
  })
})
