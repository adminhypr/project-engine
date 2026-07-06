import { describe, it, expect, beforeEach } from 'vitest'
import {
  CALENDAR_PROPS,
  loadCalendarProps,
  saveCalendarProps,
  loadCalendarMode,
  saveCalendarMode,
  STORAGE_KEY,
} from '../calendarProps'

beforeEach(() => localStorage.clear())

describe('CALENDAR_PROPS', () => {
  it('offers the Notion-style property set', () => {
    expect(CALENDAR_PROPS.map(p => p.key)).toEqual(
      ['status', 'urgency', 'assignee', 'team', 'task_id', 'due_time'])
    expect(CALENDAR_PROPS.every(p => typeof p.label === 'string' && p.label)).toBe(true)
  })
})

describe('load/saveCalendarProps', () => {
  it('defaults to none visible (matches the original minimal pill)', () => {
    expect(loadCalendarProps()).toEqual([])
  })
  it('round-trips a selection', () => {
    saveCalendarProps(['status', 'assignee'])
    expect(loadCalendarProps()).toEqual(['status', 'assignee'])
  })
  it('drops unknown keys on load (stale entries from older builds)', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['status', 'nope', 42]))
    expect(loadCalendarProps()).toEqual(['status'])
  })
  it('survives corrupted JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadCalendarProps()).toEqual([])
  })
  it('survives a non-array payload', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ status: true }))
    expect(loadCalendarProps()).toEqual([])
  })
})

describe('load/saveCalendarMode', () => {
  it('defaults to month', () => {
    expect(loadCalendarMode()).toBe('month')
  })
  it('round-trips week', () => {
    saveCalendarMode('week')
    expect(loadCalendarMode()).toBe('week')
  })
  it('ignores unknown values', () => {
    localStorage.setItem('pe-calendar-mode', 'fortnight')
    expect(loadCalendarMode()).toBe('month')
  })
})
