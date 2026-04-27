import { describe, it, expect } from 'vitest'
import {
  computeNextRun,
  formatIntervalLabel,
  formatCountdown,
  validateTemplateDraft,
} from '../recurrence'

describe('computeNextRun', () => {
  it('returns the anchor itself when it is strictly in the future', () => {
    const anchor = new Date('2026-05-01T09:00:00Z')
    const from   = new Date('2026-04-27T09:00:00Z')
    expect(computeNextRun({ anchor, intervalUnit: 'week', intervalEvery: 1, from }))
      .toEqual(anchor)
  })

  it('advances by one day for day-unit when anchor is in the past', () => {
    const anchor = new Date('2026-04-26T09:00:00Z')
    const from   = new Date('2026-04-27T09:00:00Z')
    const next   = computeNextRun({ anchor, intervalUnit: 'day', intervalEvery: 1, from })
    expect(next.toISOString()).toBe('2026-04-28T09:00:00.000Z')
  })

  it('advances by N weeks correctly', () => {
    const anchor = new Date('2026-04-20T09:00:00Z')
    const from   = new Date('2026-04-27T12:00:00Z')
    const next   = computeNextRun({ anchor, intervalUnit: 'week', intervalEvery: 2, from })
    expect(next.toISOString()).toBe('2026-05-04T09:00:00.000Z')
  })

  it('handles month rollover with month-end clamping', () => {
    const anchor = new Date('2026-01-31T09:00:00Z')
    const from   = new Date('2026-02-15T09:00:00Z')
    const next   = computeNextRun({ anchor, intervalUnit: 'month', intervalEvery: 1, from })
    // Jan 31 + 1 month → Feb 28 (2026 is non-leap).
    expect(next.toISOString()).toBe('2026-02-28T09:00:00.000Z')
  })

  it('never backfills — even after long pause, returns next future occurrence only', () => {
    const anchor = new Date('2026-01-01T09:00:00Z')
    const from   = new Date('2026-04-27T09:00:00Z') // ~16 weeks later
    const next   = computeNextRun({ anchor, intervalUnit: 'week', intervalEvery: 1, from })
    expect(next.getTime()).toBeGreaterThan(from.getTime())
    // Caller would only ever spawn ONE task, not 16.
  })

  it('returns null on invalid inputs', () => {
    expect(computeNextRun({ anchor: null, intervalUnit: 'day', intervalEvery: 1 })).toBeNull()
    expect(computeNextRun({ anchor: new Date('NaN'), intervalUnit: 'day', intervalEvery: 1 })).toBeNull()
    expect(computeNextRun({ anchor: new Date(), intervalUnit: 'fortnight', intervalEvery: 1 })).toBeNull()
    expect(computeNextRun({ anchor: new Date(), intervalUnit: 'day', intervalEvery: 0 })).toBeNull()
    expect(computeNextRun({ anchor: new Date(), intervalUnit: 'day', intervalEvery: -1 })).toBeNull()
  })
})

describe('formatIntervalLabel', () => {
  it('singular form when every === 1', () => {
    expect(formatIntervalLabel('day', 1)).toBe('every day')
    expect(formatIntervalLabel('week', 1)).toBe('every week')
    expect(formatIntervalLabel('month', 1)).toBe('every month')
  })

  it('plural form when every > 1', () => {
    expect(formatIntervalLabel('day', 3)).toBe('every 3 days')
    expect(formatIntervalLabel('week', 2)).toBe('every 2 weeks')
    expect(formatIntervalLabel('month', 6)).toBe('every 6 months')
  })

  it('returns empty string for invalid input', () => {
    expect(formatIntervalLabel('fortnight', 1)).toBe('')
    expect(formatIntervalLabel('day', 0)).toBe('')
    expect(formatIntervalLabel(null, 1)).toBe('')
  })
})

describe('formatCountdown', () => {
  const now = new Date('2026-04-27T12:00:00Z')

  it('"due now" when target is in the past or now', () => {
    expect(formatCountdown(new Date('2026-04-27T11:00:00Z'), now)).toBe('due now')
    expect(formatCountdown(now, now)).toBe('due now')
  })

  it('days when target is more than a day away', () => {
    expect(formatCountdown(new Date('2026-04-30T12:00:00Z'), now)).toBe('in 3 days')
    expect(formatCountdown(new Date('2026-04-28T12:00:00Z'), now)).toBe('in 1 day')
  })

  it('hours when within a day', () => {
    expect(formatCountdown(new Date('2026-04-27T15:00:00Z'), now)).toBe('in 3 hours')
    expect(formatCountdown(new Date('2026-04-27T13:00:00Z'), now)).toBe('in 1 hour')
  })

  it('minutes when within an hour', () => {
    expect(formatCountdown(new Date('2026-04-27T12:30:00Z'), now)).toBe('in 30 minutes')
    expect(formatCountdown(new Date('2026-04-27T12:01:00Z'), now)).toBe('in 1 minute')
  })

  it('returns empty string for invalid date', () => {
    expect(formatCountdown(null, now)).toBe('')
    expect(formatCountdown(new Date('NaN'), now)).toBe('')
  })
})

describe('validateTemplateDraft', () => {
  const valid = {
    template_title: 'Weekly review',
    interval_unit: 'week',
    interval_every: 1,
    anchor_at: '2026-05-01T09:00:00Z',
    assignee_ids: ['user-a'],
    template_due_offset_hours: 24,
  }

  it('accepts a complete draft', () => {
    const r = validateTemplateDraft(valid)
    expect(r.ok).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('rejects empty title', () => {
    const r = validateTemplateDraft({ ...valid, template_title: '   ' })
    expect(r.ok).toBe(false)
    expect(r.errors).toContain('Title is required')
  })

  it('rejects bad interval_unit', () => {
    const r = validateTemplateDraft({ ...valid, interval_unit: 'fortnight' })
    expect(r.errors).toContain('Pick an interval')
  })

  it('rejects interval_every < 1', () => {
    expect(validateTemplateDraft({ ...valid, interval_every: 0 }).errors)
      .toContain('Repeat must be at least 1')
  })

  it('rejects missing anchor_at', () => {
    expect(validateTemplateDraft({ ...valid, anchor_at: null }).errors)
      .toContain('Pick a start date')
  })

  it('rejects empty assignee list', () => {
    expect(validateTemplateDraft({ ...valid, assignee_ids: [] }).errors)
      .toContain('Pick at least one assignee')
  })

  it('rejects negative due offset', () => {
    expect(validateTemplateDraft({ ...valid, template_due_offset_hours: -1 }).errors)
      .toContain('Due offset cannot be negative')
  })
})
