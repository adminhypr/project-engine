import { describe, it, expect } from 'vitest'
import {
  monthMatrix,
  weekMatrix,
  bucketTasksByDay,
  addMonths,
  formatMonthTitle,
  formatWeekTitle,
  shiftAnchor,
  toIsoDay,
  dueDateForDay,
  dueDayIso,
} from '../calendar'

// month is 0-based throughout (JS Date convention).

describe('monthMatrix', () => {
  it('builds July 2026 with Monday start: 5 weeks, spillover on both ends', () => {
    const weeks = monthMatrix(2026, 6) // Jul 1 2026 is a Wednesday
    expect(weeks.length).toBe(5)
    expect(weeks.every(w => w.length === 7)).toBe(true)
    // first week starts Mon Jun 29
    expect(weeks[0][0]).toMatchObject({ iso: '2026-06-29', dayOfMonth: 29, inMonth: false })
    expect(weeks[0][2]).toMatchObject({ iso: '2026-07-01', dayOfMonth: 1, inMonth: true })
    // last week ends Sun Aug 2
    expect(weeks[4][6]).toMatchObject({ iso: '2026-08-02', dayOfMonth: 2, inMonth: false })
    expect(weeks[4][4]).toMatchObject({ iso: '2026-07-31', inMonth: true })
  })

  it('builds a perfect 4-week month with no spillover (Feb 2027 starts Monday)', () => {
    const weeks = monthMatrix(2027, 1)
    expect(weeks.length).toBe(4)
    expect(weeks[0][0].iso).toBe('2027-02-01')
    expect(weeks[3][6].iso).toBe('2027-02-28')
    expect(weeks.flat().every(c => c.inMonth)).toBe(true)
  })

  it('handles leap February (2028 has Feb 29)', () => {
    const weeks = monthMatrix(2028, 1)
    const isos = weeks.flat().map(c => c.iso)
    expect(isos).toContain('2028-02-29')
  })

  it('marks today via injectable now and only inside the right month', () => {
    const now = new Date(2026, 6, 5, 14, 30) // Jul 5 2026, local
    const july = monthMatrix(2026, 6, { now })
    expect(july.flat().find(c => c.isToday)?.iso).toBe('2026-07-05')
    const august = monthMatrix(2026, 7, { now })
    expect(august.flat().filter(c => c.isToday && c.inMonth)).toEqual([])
  })
})

describe('weekMatrix', () => {
  it('returns the Monday-start week containing the anchor', () => {
    const week = weekMatrix('2026-07-05') // a Sunday
    expect(week.length).toBe(7)
    expect(week[0].iso).toBe('2026-06-29') // Monday
    expect(week[6].iso).toBe('2026-07-05')
    expect(week.every(c => c.inMonth)).toBe(true) // week view has no spillover concept
  })
  it('anchor already Monday stays put', () => {
    expect(weekMatrix('2026-07-06')[0].iso).toBe('2026-07-06')
  })
  it('marks today via injectable now', () => {
    const now = new Date(2026, 6, 5, 9, 0)
    const week = weekMatrix('2026-07-01', { now })
    expect(week.find(c => c.isToday)?.iso).toBe('2026-07-05')
  })
})

describe('formatWeekTitle', () => {
  it('same-month week: "Jul 6 – 12, 2026"', () => {
    expect(formatWeekTitle(weekMatrix('2026-07-06'))).toBe('Jul 6 – 12, 2026')
  })
  it('cross-month week: "Jun 29 – Jul 5, 2026"', () => {
    expect(formatWeekTitle(weekMatrix('2026-07-05'))).toBe('Jun 29 – Jul 5, 2026')
  })
  it('cross-year week: "Dec 29, 2025 – Jan 4, 2026"', () => {
    expect(formatWeekTitle(weekMatrix('2026-01-01'))).toBe('Dec 29, 2025 – Jan 4, 2026')
  })
})

describe('shiftAnchor', () => {
  it('month mode moves by calendar month (first of month)', () => {
    expect(shiftAnchor('2026-07-15', 'month', 1)).toBe('2026-08-01')
    expect(shiftAnchor('2026-01-15', 'month', -1)).toBe('2025-12-01')
  })
  it('week mode moves by 7 days', () => {
    expect(shiftAnchor('2026-07-05', 'week', 1)).toBe('2026-07-12')
    expect(shiftAnchor('2026-07-05', 'week', -1)).toBe('2026-06-28')
  })
})

describe('bucketTasksByDay', () => {
  const tasks = [
    { id: 'a', title: 'date-only', due_date: '2026-07-05' },
    { id: 'b', title: 'same day', due_date: '2026-07-05' },
    { id: 'c', title: 'timestamp', due_date: '2026-07-06T09:30:00' },
    { id: 'd', title: 'no due', due_date: null },
    { id: 'e', title: 'also none' }, // undefined
  ]

  it('buckets date-only strings on their LOCAL day (UTC-midnight pitfall)', () => {
    const { byDay } = bucketTasksByDay(tasks)
    expect(byDay.get('2026-07-05')?.map(t => t.id)).toEqual(['a', 'b'])
  })

  it('buckets full timestamps by their local day', () => {
    const { byDay } = bucketTasksByDay(tasks)
    expect(byDay.get('2026-07-06')?.map(t => t.id)).toEqual(['c'])
  })

  it('collects undated tasks separately', () => {
    const { undated } = bucketTasksByDay(tasks)
    expect(undated.map(t => t.id)).toEqual(['d', 'e'])
  })

  it('tolerates empty and non-array input', () => {
    expect(bucketTasksByDay([]).undated).toEqual([])
    expect(bucketTasksByDay(null).byDay.size).toBe(0)
    expect(bucketTasksByDay({ tasks }).undated).toEqual([])
  })
})

describe('addMonths', () => {
  it('moves forward across a year boundary', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
  })
  it('moves backward across a year boundary', () => {
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
  })
  it('handles multi-month deltas', () => {
    expect(addMonths(2026, 6, 7)).toEqual({ year: 2027, month: 1 })
    expect(addMonths(2026, 6, -19)).toEqual({ year: 2024, month: 11 })
  })
})

describe('formatMonthTitle', () => {
  it('renders "Month Year"', () => {
    expect(formatMonthTitle(2026, 6)).toBe('July 2026')
    expect(formatMonthTitle(2027, 0)).toBe('January 2027')
  })
})

describe('dueDateForDay', () => {
  // tasks.due_date is timestamptz — writing a bare 'YYYY-MM-DD' stores UTC
  // midnight, which renders as the PREVIOUS local day for negative-UTC
  // users (and due times drive the 4h/24h reminder emails). Rescheduling
  // must keep the local time-of-day and change only the day.
  it('keeps the local time-of-day when moving to another day', () => {
    const prev = new Date(2026, 6, 5, 20, 30).toISOString() // Jul 5 8:30 PM local
    const next = dueDateForDay(prev, '2026-07-10')
    const d = new Date(next)
    expect(toIsoDay(d)).toBe('2026-07-10')
    expect(d.getHours()).toBe(20)
    expect(d.getMinutes()).toBe(30)
  })
  it('defaults to 17:00 local when the task had no due date (tray drop)', () => {
    const d = new Date(dueDateForDay(null, '2026-07-15'))
    expect(toIsoDay(d)).toBe('2026-07-15')
    expect(d.getHours()).toBe(17)
  })
  it('returns a full ISO timestamp, not a bare date', () => {
    expect(dueDateForDay(null, '2026-07-15')).toMatch(/T\d{2}:\d{2}/)
  })
  it('returns null for an invalid target day', () => {
    expect(dueDateForDay(null, 'not-a-day')).toBeNull()
  })
})

describe('dueDayIso', () => {
  it('returns the LOCAL day for a timestamptz value', () => {
    const prev = new Date(2026, 6, 14, 20, 0).toISOString()
    expect(dueDayIso(prev)).toBe('2026-07-14')
  })
  it('passes through date-only strings and handles null', () => {
    expect(dueDayIso('2026-07-05')).toBe('2026-07-05')
    expect(dueDayIso(null)).toBeNull()
  })
})

describe('toIsoDay', () => {
  it('formats a local Date as YYYY-MM-DD with padding', () => {
    expect(toIsoDay(new Date(2026, 0, 3))).toBe('2026-01-03')
    expect(toIsoDay(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})
