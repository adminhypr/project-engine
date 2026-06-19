import { describe, it, expect } from 'vitest'
import {
  shouldMarkReadOnOpen,
  shouldMarkReadOnNewMessage,
  isNewTail,
} from '@/lib/markReadDecision'

describe('shouldMarkReadOnOpen', () => {
  it('marks read on open only when the tab is visible', () => {
    expect(shouldMarkReadOnOpen({ visible: true })).toBe(true)
    expect(shouldMarkReadOnOpen({ visible: false })).toBe(false)
  })
})

describe('shouldMarkReadOnNewMessage', () => {
  const base = { visible: true, focused: true, atBottom: true, activelyViewed: true }

  it('marks read only when visible AND focused AND at bottom AND actively viewed', () => {
    expect(shouldMarkReadOnNewMessage(base)).toBe(true)
  })

  it('does not mark read when the tab is hidden', () => {
    expect(shouldMarkReadOnNewMessage({ ...base, visible: false })).toBe(false)
  })

  it('does not mark read when the window is unfocused', () => {
    expect(shouldMarkReadOnNewMessage({ ...base, focused: false })).toBe(false)
  })

  it('does not mark read when scrolled up (not at bottom)', () => {
    expect(shouldMarkReadOnNewMessage({ ...base, atBottom: false })).toBe(false)
  })

  it('does not mark read when the pane is not the actively-viewed one', () => {
    expect(shouldMarkReadOnNewMessage({ ...base, activelyViewed: false })).toBe(false)
  })

  it('defaults activelyViewed to true when the caller omits it (full-page pane)', () => {
    expect(shouldMarkReadOnNewMessage({ visible: true, focused: true, atBottom: true })).toBe(true)
  })
})

describe('isNewTail', () => {
  it('true when the newest message id changed (genuinely new latest message)', () => {
    expect(isNewTail('m1', 'm2')).toBe(true)
  })

  it('false when the tail id is unchanged (a Load-earlier prepend grew length but kept the tail)', () => {
    expect(isNewTail('m9', 'm9')).toBe(false)
  })

  it('false on the very first load (no previous tail — open/switch path owns it)', () => {
    expect(isNewTail(null, 'm1')).toBe(false)
  })

  it('false when there is no current tail (empty conversation)', () => {
    expect(isNewTail('m1', null)).toBe(false)
    expect(isNewTail(null, null)).toBe(false)
  })
})
