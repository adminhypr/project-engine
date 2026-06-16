import { describe, it, expect } from 'vitest'
import { buildCallMessageContent, extractMeetUrl, isCallMessage } from '../meetLink'

describe('buildCallMessageContent', () => {
  it('embeds the url in a readable body', () => {
    const url = 'https://meet.google.com/abc-defg-hij'
    const body = buildCallMessageContent(url)
    expect(body).toContain(url)
    expect(extractMeetUrl(body)).toBe(url)
  })
})

describe('extractMeetUrl', () => {
  it('pulls a Meet url out of the body', () => {
    expect(extractMeetUrl('📞 Started a call: https://meet.google.com/abc-defg-hij'))
      .toBe('https://meet.google.com/abc-defg-hij')
  })
  it('returns null when there is no Meet url', () => {
    expect(extractMeetUrl('hello there')).toBe(null)
    expect(extractMeetUrl('https://example.com/foo')).toBe(null)
  })
  it('handles empty / non-string input', () => {
    expect(extractMeetUrl('')).toBe(null)
    expect(extractMeetUrl(null)).toBe(null)
    expect(extractMeetUrl(undefined)).toBe(null)
  })
})

describe('isCallMessage', () => {
  it('is true only for kind=call', () => {
    expect(isCallMessage({ kind: 'call' })).toBe(true)
    expect(isCallMessage({ kind: 'user' })).toBe(false)
    expect(isCallMessage({ kind: 'system' })).toBe(false)
    expect(isCallMessage(null)).toBe(false)
    expect(isCallMessage({})).toBe(false)
  })
})
