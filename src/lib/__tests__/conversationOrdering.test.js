import { describe, it, expect } from 'vitest'
import { sortByLastMessage, upsertConversation } from '../conversationOrdering'

describe('sortByLastMessage', () => {
  it('sorts descending by last_message_at', () => {
    const input = [
      { id: 'a', last_message_at: '2026-04-17T10:00:00Z' },
      { id: 'b', last_message_at: '2026-04-17T12:00:00Z' },
      { id: 'c', last_message_at: '2026-04-17T11:00:00Z' },
    ]
    expect(sortByLastMessage(input).map(c => c.id)).toEqual(['b', 'c', 'a'])
  })
  it('does not mutate the input', () => {
    const input = [{ id: 'a', last_message_at: '2026-04-17T10:00:00Z' }]
    sortByLastMessage(input)
    expect(input[0].id).toBe('a')
  })
})

describe('upsertConversation', () => {
  const conv = (id, t, preview) => ({ id, last_message_at: t, last_message_preview: preview, unread: 0 })

  it('adds a new conversation at the top', () => {
    const list = [conv('a', '2026-04-17T10:00:00Z', 'old')]
    const out = upsertConversation(list, conv('b', '2026-04-17T11:00:00Z', 'new'))
    expect(out.map(c => c.id)).toEqual(['b', 'a'])
  })
  it('updates an existing conversation and re-sorts', () => {
    const list = [
      conv('a', '2026-04-17T10:00:00Z', 'old'),
      conv('b', '2026-04-17T09:00:00Z', 'older'),
    ]
    const out = upsertConversation(list, { ...conv('b', '2026-04-17T12:00:00Z', 'newest'), unread: 5 })
    expect(out[0].id).toBe('b')
    expect(out[0].last_message_preview).toBe('newest')
    expect(out[0].unread).toBe(5)
  })
})
