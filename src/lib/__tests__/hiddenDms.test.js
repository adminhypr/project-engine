import { describe, it, expect, beforeEach } from 'vitest'
import { readHiddenDms, hideDm, unhideDm, hiddenDmsKey } from '@/lib/hiddenDms'

// jsdom provides a real localStorage; clear it between tests.
beforeEach(() => {
  localStorage.clear()
})

describe('hiddenDms', () => {
  it('reads an empty array when nothing is stored', () => {
    expect(readHiddenDms('me')).toEqual([])
  })

  it('hides a DM and reads it back', () => {
    hideDm('me', 'c1')
    expect(readHiddenDms('me')).toEqual(['c1'])
  })

  it('dedups when the same id is hidden twice', () => {
    hideDm('me', 'c1')
    hideDm('me', 'c1')
    expect(readHiddenDms('me')).toEqual(['c1'])
  })

  it('unhides a DM', () => {
    hideDm('me', 'c1')
    hideDm('me', 'c2')
    unhideDm('me', 'c1')
    expect(readHiddenDms('me')).toEqual(['c2'])
  })

  it('unhiding an absent id is a no-op', () => {
    hideDm('me', 'c1')
    unhideDm('me', 'nope')
    expect(readHiddenDms('me')).toEqual(['c1'])
  })

  it('is scoped per profile', () => {
    hideDm('a', 'c1')
    hideDm('b', 'c2')
    expect(readHiddenDms('a')).toEqual(['c1'])
    expect(readHiddenDms('b')).toEqual(['c2'])
  })

  it('returns [] safely when profileId is missing', () => {
    expect(readHiddenDms(null)).toEqual([])
    expect(hideDm(null, 'c1')).toEqual([])
  })

  it('tolerates corrupt stored JSON', () => {
    localStorage.setItem(hiddenDmsKey('me'), '{not json')
    expect(readHiddenDms('me')).toEqual([])
  })

  it('dedups a corrupt-but-duplicated stored array', () => {
    localStorage.setItem(hiddenDmsKey('me'), JSON.stringify(['c1', 'c1', 'c2']))
    expect(readHiddenDms('me')).toEqual(['c1', 'c2'])
  })
})
