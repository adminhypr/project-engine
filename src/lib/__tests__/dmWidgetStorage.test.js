import { describe, it, expect, beforeEach } from 'vitest'
import { readWidgetState, writeWidgetState, DEFAULT_STATE } from '../dmWidgetStorage'

describe('dmWidgetStorage', () => {
  beforeEach(() => { localStorage.clear() })

  it('returns default state when nothing is stored', () => {
    expect(readWidgetState('user-1')).toEqual(DEFAULT_STATE)
  })

  it('round-trips state for a profile', () => {
    const state = { expanded: true, openConversationIds: ['c1','c2'], minimizedIds: ['c3'] }
    writeWidgetState('user-1', state)
    expect(readWidgetState('user-1')).toEqual(state)
  })

  it('isolates state per profile id', () => {
    writeWidgetState('user-1', { expanded: true, openConversationIds: ['a'], minimizedIds: [] })
    writeWidgetState('user-2', { expanded: false, openConversationIds: [], minimizedIds: ['b'] })
    expect(readWidgetState('user-1').openConversationIds).toEqual(['a'])
    expect(readWidgetState('user-2').minimizedIds).toEqual(['b'])
  })

  it('falls back to default on malformed JSON', () => {
    localStorage.setItem('pe-chat-state-user-1', '{not valid json')
    expect(readWidgetState('user-1')).toEqual(DEFAULT_STATE)
  })

  it('falls back to default on wrong shape', () => {
    localStorage.setItem('pe-chat-state-user-1', JSON.stringify({ foo: 'bar' }))
    expect(readWidgetState('user-1')).toEqual(DEFAULT_STATE)
  })

  it('returns default when profileId is falsy', () => {
    expect(readWidgetState(null)).toEqual(DEFAULT_STATE)
    expect(readWidgetState(undefined)).toEqual(DEFAULT_STATE)
    expect(readWidgetState('')).toEqual(DEFAULT_STATE)
  })
})
