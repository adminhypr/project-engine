import { describe, it, expect } from 'vitest'
import { generateTaskId, formatDate, formatDateShort, daysBetween } from '../helpers'

describe('generateTaskId', () => {
  it('starts with T-', () => {
    expect(generateTaskId()).toMatch(/^T-/)
  })

  it('is 8 characters long (T- + 6 chars)', () => {
    expect(generateTaskId()).toHaveLength(8)
  })

  it('contains only uppercase alphanumeric after T-', () => {
    const id = generateTaskId()
    expect(id.slice(2)).toMatch(/^[A-Z0-9]+$/)
  })

  it('generates IDs based on timestamp', () => {
    const id1 = generateTaskId()
    const id2 = generateTaskId()
    // Same millisecond = same ID, but format is consistent
    expect(id1).toMatch(/^T-[A-Z0-9]{6}$/)
    expect(id2).toMatch(/^T-[A-Z0-9]{6}$/)
  })
})

describe('formatDate', () => {
  it('returns em dash for falsy input', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate('')).toBe('—')
  })

  it('formats a valid date string', () => {
    const result = formatDate('2026-03-19T14:30:00Z')
    expect(result).toContain('Mar')
    expect(result).toContain('19')
    expect(result).toContain('2026')
  })
})

describe('formatDateShort', () => {
  it('returns em dash for falsy input', () => {
    expect(formatDateShort(null)).toBe('—')
  })

  it('formats without time', () => {
    const result = formatDateShort('2026-03-19T14:30:00Z')
    expect(result).toContain('Mar')
    expect(result).toContain('2026')
  })
})

describe('daysBetween', () => {
  it('returns 0 for same date', () => {
    expect(daysBetween('2026-03-19', '2026-03-19')).toBe(0)
  })

  it('returns correct number of days', () => {
    expect(daysBetween('2026-03-19', '2026-03-22')).toBe(3)
  })

  it('works regardless of order', () => {
    expect(daysBetween('2026-03-22', '2026-03-19')).toBe(3)
  })
})
