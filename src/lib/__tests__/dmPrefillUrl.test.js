import { describe, it, expect } from 'vitest'
import { buildPrefillUrl, parsePrefillParams } from '../dmPrefillUrl'

describe('buildPrefillUrl', () => {
  it('builds an /assign URL with encoded params', () => {
    const url = buildPrefillUrl({
      assigneeId: 'u1', teamId: 't1', title: 'Q1 report', urgency: 'High',
      dueDate: '2026-04-20', notes: 'hello & goodbye',
    })
    expect(url).toBe(
      '/assign?assignee=u1&team=t1&title=Q1+report&urgency=High&due=2026-04-20&notes=hello+%26+goodbye'
    )
  })
  it('omits undefined/null/empty params', () => {
    const url = buildPrefillUrl({ assigneeId: 'u1' })
    expect(url).toBe('/assign?assignee=u1')
  })
})

describe('parsePrefillParams', () => {
  it('extracts all known keys', () => {
    const params = new URLSearchParams(
      'assignee=u1&team=t1&title=Q1+report&urgency=High&due=2026-04-20&notes=hi'
    )
    expect(parsePrefillParams(params)).toEqual({
      assigneeId: 'u1', teamId: 't1', title: 'Q1 report',
      urgency: 'High', dueDate: '2026-04-20', notes: 'hi',
    })
  })
  it('returns an object with undefined fields for missing keys', () => {
    const params = new URLSearchParams('assignee=u1')
    const parsed = parsePrefillParams(params)
    expect(parsed.assigneeId).toBe('u1')
    expect(parsed.title).toBeUndefined()
  })
})
