import { describe, it, expect, beforeEach } from 'vitest'
import {
  readStarred,
  starConversation,
  unstarConversation,
  isStarred,
  starredKey,
} from '@/lib/starredConversations'

// jsdom provides a real localStorage; clear it between tests.
beforeEach(() => {
  localStorage.clear()
})

describe('starredConversations', () => {
  it('reads an empty array when nothing is stored', () => {
    expect(readStarred('me')).toEqual([])
  })

  it('stars a conversation and reads it back', () => {
    starConversation('me', 'c1')
    expect(readStarred('me')).toEqual(['c1'])
  })

  it('dedups when the same id is starred twice', () => {
    starConversation('me', 'c1')
    starConversation('me', 'c1')
    expect(readStarred('me')).toEqual(['c1'])
  })

  it('unstars a conversation', () => {
    starConversation('me', 'c1')
    starConversation('me', 'c2')
    unstarConversation('me', 'c1')
    expect(readStarred('me')).toEqual(['c2'])
  })

  it('unstarring an absent id is a no-op', () => {
    starConversation('me', 'c1')
    unstarConversation('me', 'nope')
    expect(readStarred('me')).toEqual(['c1'])
  })

  it('is scoped per profile', () => {
    starConversation('a', 'c1')
    starConversation('b', 'c2')
    expect(readStarred('a')).toEqual(['c1'])
    expect(readStarred('b')).toEqual(['c2'])
  })

  it('returns [] safely when profileId is missing', () => {
    expect(readStarred(null)).toEqual([])
    expect(starConversation(null, 'c1')).toEqual([])
  })

  it('tolerates corrupt stored JSON', () => {
    localStorage.setItem(starredKey('me'), '{not json')
    expect(readStarred('me')).toEqual([])
  })

  it('dedups a corrupt-but-duplicated stored array', () => {
    localStorage.setItem(starredKey('me'), JSON.stringify(['c1', 'c1', 'c2']))
    expect(readStarred('me')).toEqual(['c1', 'c2'])
  })

  it('isStarred reflects current state', () => {
    expect(isStarred('me', 'c1')).toBe(false)
    starConversation('me', 'c1')
    expect(isStarred('me', 'c1')).toBe(true)
    expect(isStarred('me', null)).toBe(false)
  })
})
