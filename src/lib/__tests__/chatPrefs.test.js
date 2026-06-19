import { describe, it, expect, beforeEach, vi } from 'vitest'
import { DEFAULTS, SIDEBAR_THEMES, getPrefs, setPref, subscribe } from '../chatPrefs'
import { formatChatTime } from '../formatTime'

// chatPrefs reads globalThis.localStorage. jsdom provides one; clear between tests.
beforeEach(() => {
  globalThis.localStorage.clear()
})

describe('chatPrefs store', () => {
  it('returns DEFAULTS for an unknown profile', () => {
    expect(getPrefs('nobody')).toEqual(DEFAULTS)
  })

  it('returns DEFAULTS when profileId is missing', () => {
    expect(getPrefs(undefined)).toEqual(DEFAULTS)
    expect(getPrefs(null)).toEqual(DEFAULTS)
  })

  it('round-trips a set/get', () => {
    setPref('alice', 'density', 'compact')
    expect(getPrefs('alice').density).toBe('compact')
    // unset keys still fall back to defaults
    expect(getPrefs('alice').timeFormat).toBe('12h')
  })

  it('persists multiple keys independently', () => {
    setPref('alice', 'sound', false)
    setPref('alice', 'sidebarTheme', 'ocean')
    const p = getPrefs('alice')
    expect(p.sound).toBe(false)
    expect(p.sidebarTheme).toBe('ocean')
  })

  it('scopes prefs per profile (A does not leak to B)', () => {
    setPref('alice', 'theme', 'dark')
    expect(getPrefs('alice').theme).toBe('dark')
    expect(getPrefs('bob').theme).toBe('system') // default, unaffected
  })

  it('ignores unknown keys on set', () => {
    setPref('alice', 'bogusKey', 'x')
    expect('bogusKey' in getPrefs('alice')).toBe(false)
  })

  it('tolerates corrupt JSON in storage', () => {
    globalThis.localStorage.setItem('pe-chat-prefs-alice', '{not valid json')
    expect(getPrefs('alice')).toEqual(DEFAULTS)
  })

  it('tolerates a non-object stored value', () => {
    globalThis.localStorage.setItem('pe-chat-prefs-alice', '"a string"')
    expect(getPrefs('alice')).toEqual(DEFAULTS)
  })

  it('fires subscribers on setPref and supports unsubscribe', () => {
    const cb = vi.fn()
    const unsub = subscribe(cb)
    setPref('alice', 'sendOnEnter', false)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith({ profileId: 'alice', key: 'sendOnEnter', value: false })
    unsub()
    setPref('alice', 'sound', false)
    expect(cb).toHaveBeenCalledTimes(1) // not called again after unsubscribe
  })

  it('exposes the 5 sidebar theme presets with the spec hexes', () => {
    expect(Object.keys(SIDEBAR_THEMES)).toEqual(['default', 'aubergine', 'ocean', 'forest', 'sunset'])
    expect(SIDEBAR_THEMES.default).toMatchObject({ sidebar: '#1a1d24', sidebar2: '#15171d', accent: '#4f46e5' })
    expect(SIDEBAR_THEMES.aubergine).toMatchObject({ sidebar: '#3f0e40', sidebar2: '#350d36', accent: '#611f69' })
    expect(SIDEBAR_THEMES.ocean.accent).toBe('#2563eb')
    expect(SIDEBAR_THEMES.forest.accent).toBe('#15803d')
    expect(SIDEBAR_THEMES.sunset.accent).toBe('#c2410c')
  })

  it('has the spec defaults', () => {
    expect(DEFAULTS).toEqual({
      theme: 'system',
      sidebarTheme: 'default',
      density: 'comfortable',
      timeFormat: '12h',
      toolbarDefault: false,
      sendOnEnter: true,
      sound: true,
      desktopNotifications: false,
      dmListShowAll: false,
    })
  })
})

describe('formatChatTime', () => {
  // Build a Date at a fixed local wall-clock time so the assertions are
  // timezone-independent (we set local hours/minutes, not a UTC instant).
  const at = (h, m) => {
    const d = new Date(2026, 5, 19, h, m, 0, 0)
    return d.toISOString()
  }

  it('formats 12h with AM/PM (default)', () => {
    expect(formatChatTime(at(14, 40))).toBe('2:40 PM')
    expect(formatChatTime(at(14, 40), '12h')).toBe('2:40 PM')
  })

  it('formats 24h without AM/PM', () => {
    expect(formatChatTime(at(14, 40), '24h')).toBe('14:40')
  })

  it('handles midnight and noon edges', () => {
    expect(formatChatTime(at(0, 0), '12h')).toBe('12:00 AM')
    expect(formatChatTime(at(12, 0), '12h')).toBe('12:00 PM')
    expect(formatChatTime(at(0, 0), '24h')).toBe('00:00')
    expect(formatChatTime(at(12, 0), '24h')).toBe('12:00')
  })

  it('returns empty string for invalid input', () => {
    expect(formatChatTime('not-a-date')).toBe('')
    expect(formatChatTime(null)).toBe('')
  })
})
