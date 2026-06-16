import { describe, it, expect, beforeEach } from 'vitest'
import {
  lastOpenedKey,
  readLastOpened,
  writeLastOpened,
  clearLastOpened,
  resolveActiveConversation,
} from '../chatPage'

// Minimal in-memory storage stub so tests don't depend on jsdom localStorage.
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: k => { map.delete(k) },
    _map: map,
  }
}

describe('lastOpenedKey', () => {
  it('namespaces by profile id', () => {
    expect(lastOpenedKey('abc')).toBe('pe-chat-last-abc')
  })
})

describe('readLastOpened / writeLastOpened / clearLastOpened', () => {
  let storage
  beforeEach(() => { storage = makeStorage() })

  it('round-trips a conversation id', () => {
    writeLastOpened('u1', 'conv-9', storage)
    expect(readLastOpened('u1', storage)).toBe('conv-9')
  })

  it('returns null when nothing stored', () => {
    expect(readLastOpened('u1', storage)).toBe(null)
  })

  it('clears the stored id', () => {
    writeLastOpened('u1', 'conv-9', storage)
    clearLastOpened('u1', storage)
    expect(readLastOpened('u1', storage)).toBe(null)
  })

  it('ignores writes with missing profile or conversation id', () => {
    writeLastOpened(null, 'conv', storage)
    writeLastOpened('u1', null, storage)
    expect(storage._map.size).toBe(0)
  })

  it('does not throw when storage is unavailable', () => {
    expect(() => writeLastOpened('u1', 'c', null)).not.toThrow()
    expect(readLastOpened('u1', null)).toBe(null)
    expect(() => clearLastOpened('u1', null)).not.toThrow()
  })

  it('survives a throwing storage (private mode / quota)', () => {
    const throwing = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    expect(readLastOpened('u1', throwing)).toBe(null)
    expect(() => writeLastOpened('u1', 'c', throwing)).not.toThrow()
  })
})

describe('resolveActiveConversation', () => {
  const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

  it('finds the conversation by id', () => {
    expect(resolveActiveConversation(list, 'b')).toEqual({ id: 'b' })
  })

  it('returns null for a missing id (RLS-hidden / not loaded)', () => {
    expect(resolveActiveConversation(list, 'zzz')).toBe(null)
  })

  it('returns null when no id selected', () => {
    expect(resolveActiveConversation(list, null)).toBe(null)
    expect(resolveActiveConversation(list, undefined)).toBe(null)
  })

  it('returns null when list is not an array', () => {
    expect(resolveActiveConversation(undefined, 'a')).toBe(null)
  })
})
