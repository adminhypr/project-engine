import { describe, it, expect } from 'vitest'
import { chatViewportHeightPx } from '../chatViewport'

describe('chatViewportHeightPx', () => {
  it('rounds the visualViewport height to a px string', () => {
    expect(chatViewportHeightPx({ height: 812.4 })).toBe('812px')
    expect(chatViewportHeightPx({ height: 640 })).toBe('640px')
  })
  it('returns null when no viewport / height is given', () => {
    expect(chatViewportHeightPx(null)).toBeNull()
    expect(chatViewportHeightPx(undefined)).toBeNull()
    expect(chatViewportHeightPx({})).toBeNull()
  })
})
