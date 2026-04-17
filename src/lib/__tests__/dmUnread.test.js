import { describe, it, expect } from 'vitest'
import { unreadCount, totalUnread } from '../dmUnread'

const me = 'me'
const other = 'other'

describe('unreadCount', () => {
  it('returns 0 for empty messages', () => {
    expect(unreadCount([], '2026-04-17T00:00:00Z', me)).toBe(0)
  })

  it('counts messages newer than lastReadAt authored by others', () => {
    const msgs = [
      { created_at: '2026-04-17T10:00:00Z', author_id: other },
      { created_at: '2026-04-17T11:00:00Z', author_id: other },
      { created_at: '2026-04-17T12:00:00Z', author_id: me },
    ]
    expect(unreadCount(msgs, '2026-04-17T09:00:00Z', me)).toBe(2)
  })

  it('ignores my own messages', () => {
    const msgs = [
      { created_at: '2026-04-17T10:00:00Z', author_id: me },
      { created_at: '2026-04-17T11:00:00Z', author_id: me },
    ]
    expect(unreadCount(msgs, '2026-04-17T09:00:00Z', me)).toBe(0)
  })

  it('ignores messages at or before lastReadAt', () => {
    const msgs = [
      { created_at: '2026-04-17T09:00:00Z', author_id: other },
      { created_at: '2026-04-17T08:00:00Z', author_id: other },
    ]
    expect(unreadCount(msgs, '2026-04-17T09:00:00Z', me)).toBe(0)
  })

  it('treats null lastReadAt as "nothing read yet"', () => {
    const msgs = [{ created_at: '2026-04-17T01:00:00Z', author_id: other }]
    expect(unreadCount(msgs, null, me)).toBe(1)
  })
})

describe('totalUnread', () => {
  it('sums unread counts across conversations', () => {
    const convs = [
      { unread: 3 }, { unread: 0 }, { unread: 1 },
    ]
    expect(totalUnread(convs)).toBe(4)
  })
  it('handles missing unread field as 0', () => {
    expect(totalUnread([{}, { unread: 2 }])).toBe(2)
  })
})
