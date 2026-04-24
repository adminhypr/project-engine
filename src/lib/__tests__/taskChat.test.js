import { describe, it, expect } from 'vitest'
import {
  isTaskChatActive,
  sortTaskChatRows,
  deriveUnreadCount,
} from '../taskChat'

describe('taskChat helpers', () => {
  describe('isTaskChatActive', () => {
    it('true when parent task is not Done', () => {
      expect(isTaskChatActive({ kind: 'task', task_status: 'In Progress' })).toBe(true)
      expect(isTaskChatActive({ kind: 'task', task_status: 'Not Started' })).toBe(true)
    })
    it('false when parent task is Done', () => {
      expect(isTaskChatActive({ kind: 'task', task_status: 'Done' })).toBe(false)
    })
    it('false for non-task conversations', () => {
      expect(isTaskChatActive({ kind: 'group', task_status: null })).toBe(false)
    })
  })

  describe('sortTaskChatRows', () => {
    it('sorts by max(last_message_at, task_last_updated) desc', () => {
      const rows = [
        { id: 'a', last_message_at: '2026-04-24T10:00Z', task_last_updated: '2026-04-24T09:00Z' },
        { id: 'b', last_message_at: null,                task_last_updated: '2026-04-24T11:00Z' },
        { id: 'c', last_message_at: '2026-04-24T08:00Z', task_last_updated: null },
      ]
      expect(sortTaskChatRows(rows).map(r => r.id)).toEqual(['b', 'a', 'c'])
    })
  })

  describe('deriveUnreadCount', () => {
    it('returns 0 when last_read_at >= last_message_at', () => {
      expect(deriveUnreadCount({
        last_read_at: '2026-04-24T10:00Z',
        last_message_at: '2026-04-24T10:00Z',
        raw_unread: 0,
      })).toBe(0)
    })
    it('passes through raw unread count when last_message_at > last_read_at', () => {
      expect(deriveUnreadCount({
        last_read_at: '2026-04-24T09:00Z',
        last_message_at: '2026-04-24T10:00Z',
        raw_unread: 5,
      })).toBe(5)
    })
    it('returns 0 when raw_unread is null/undefined', () => {
      expect(deriveUnreadCount({ raw_unread: null })).toBe(0)
    })
  })
})
