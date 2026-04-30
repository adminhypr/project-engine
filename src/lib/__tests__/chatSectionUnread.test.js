import { describe, it, expect } from 'vitest'
import { totalUnread } from '../chatSectionUnread'

describe('totalUnread', () => {
  describe('conversation shape (groups / campfires / tasks)', () => {
    it('sums unread across rows', () => {
      const rows = [{ unread: 3 }, { unread: 0 }, { unread: 5 }]
      expect(totalUnread(rows)).toBe(8)
    })

    it('treats missing/undefined unread as 0', () => {
      const rows = [{ unread: 2 }, {}, { unread: null }, { unread: undefined }]
      expect(totalUnread(rows)).toBe(2)
    })

    it('ignores negative or NaN unread values', () => {
      const rows = [{ unread: 5 }, { unread: -3 }, { unread: NaN }]
      expect(totalUnread(rows)).toBe(5)
    })
  })

  describe('people shape (recent / teammates / company)', () => {
    it('reads from row.conversation.unread', () => {
      const rows = [
        { profile: { id: 'a' }, conversation: { unread: 1 } },
        { profile: { id: 'b' }, conversation: { unread: 4 } },
        { profile: { id: 'c' } }, // no conversation
      ]
      expect(totalUnread(rows, 'people')).toBe(5)
    })

    it('handles a missing conversation field', () => {
      const rows = [
        { profile: { id: 'a' } },
        { profile: { id: 'b' }, conversation: null },
      ]
      expect(totalUnread(rows, 'people')).toBe(0)
    })
  })

  describe('edge cases', () => {
    it('returns 0 for empty array', () => {
      expect(totalUnread([])).toBe(0)
    })

    it('returns 0 for null / undefined / non-array input', () => {
      expect(totalUnread(null)).toBe(0)
      expect(totalUnread(undefined)).toBe(0)
      expect(totalUnread('nope')).toBe(0)
    })
  })
})
