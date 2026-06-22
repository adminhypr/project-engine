import { describe, it, expect } from 'vitest'
import { shouldToggleMessageActions } from '../chatTouch'

describe('shouldToggleMessageActions', () => {
  it('toggles only on coarse pointers when no interactive element was hit', () => {
    expect(shouldToggleMessageActions({ coarsePointer: true, hitInteractive: false })).toBe(true)
  })
  it('never toggles on fine pointers (desktop uses hover)', () => {
    expect(shouldToggleMessageActions({ coarsePointer: false, hitInteractive: false })).toBe(false)
  })
  it('never toggles when the tap hit a link/button/image/toolbar', () => {
    expect(shouldToggleMessageActions({ coarsePointer: true, hitInteractive: true })).toBe(false)
  })
})
