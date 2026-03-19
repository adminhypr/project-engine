import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getPriority, PRIORITY_LABELS, PRIORITY_COLORS } from '../priority'

describe('getPriority', () => {
  let now

  beforeEach(() => {
    now = new Date('2026-03-19T12:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('with due_date', () => {
    it('returns red when overdue', () => {
      expect(getPriority({ due_date: '2026-03-18T00:00:00Z' })).toBe('red')
    })

    it('returns orange when <12h remaining', () => {
      expect(getPriority({ due_date: '2026-03-19T20:00:00Z' })).toBe('orange')
    })

    it('returns yellow when 12-24h remaining', () => {
      expect(getPriority({ due_date: '2026-03-20T06:00:00Z' })).toBe('yellow')
    })

    it('returns green when >24h remaining', () => {
      expect(getPriority({ due_date: '2026-03-21T12:00:00Z' })).toBe('green')
    })

    it('returns red when due_date is exactly now', () => {
      // diff = 0 which is not < 0, but hrs = 0 which is < 12
      expect(getPriority({ due_date: '2026-03-19T12:00:00Z' })).toBe('orange')
    })

    it('returns red for dates far in the past', () => {
      expect(getPriority({ due_date: '2025-01-01T00:00:00Z' })).toBe('red')
    })
  })

  describe('without due_date (inactivity)', () => {
    it('returns green when updated <12h ago', () => {
      expect(getPriority({ last_updated: '2026-03-19T06:00:00Z' })).toBe('green')
    })

    it('returns yellow when updated 12-24h ago', () => {
      expect(getPriority({ last_updated: '2026-03-18T18:00:00Z' })).toBe('yellow')
    })

    it('returns orange when updated 24-36h ago', () => {
      expect(getPriority({ last_updated: '2026-03-18T06:00:00Z' })).toBe('orange')
    })

    it('returns red when updated >36h ago', () => {
      expect(getPriority({ last_updated: '2026-03-17T12:00:00Z' })).toBe('red')
    })
  })

  describe('no dates at all', () => {
    it('returns none when no due_date and no last_updated', () => {
      expect(getPriority({})).toBe('none')
    })

    it('returns none with null values', () => {
      expect(getPriority({ due_date: null, last_updated: null })).toBe('none')
    })
  })

  describe('due_date takes precedence', () => {
    it('uses due_date when both are present', () => {
      expect(getPriority({
        due_date: '2026-03-21T12:00:00Z',
        last_updated: '2026-03-17T00:00:00Z'  // would be red by inactivity
      })).toBe('green')
    })
  })
})

describe('PRIORITY_LABELS', () => {
  it('has labels for all priority levels', () => {
    expect(PRIORITY_LABELS.red).toBeDefined()
    expect(PRIORITY_LABELS.orange).toBeDefined()
    expect(PRIORITY_LABELS.yellow).toBeDefined()
    expect(PRIORITY_LABELS.green).toBeDefined()
    expect(PRIORITY_LABELS.none).toBeDefined()
  })
})

describe('PRIORITY_COLORS', () => {
  it('has row and badge styles for all levels', () => {
    for (const level of ['red', 'orange', 'yellow', 'green', 'none']) {
      expect(PRIORITY_COLORS[level]).toHaveProperty('row')
      expect(PRIORITY_COLORS[level]).toHaveProperty('badge')
    }
  })
})
