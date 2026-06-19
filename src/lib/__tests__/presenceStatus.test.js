import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  STATUS_VALUES,
  DEFAULT_STATUS,
  getStatus,
  setStatus,
  effectiveStatus,
  subscribe,
} from '../presenceStatus'

// presenceStatus reads globalThis.localStorage. jsdom provides one; clear between tests.
beforeEach(() => {
  globalThis.localStorage.clear()
})

describe('presenceStatus store', () => {
  it('returns the default for an unknown profile', () => {
    expect(getStatus('nobody')).toBe(DEFAULT_STATUS)
    expect(DEFAULT_STATUS).toBe('auto')
  })

  it('returns the default when profileId is missing', () => {
    expect(getStatus(undefined)).toBe('auto')
    expect(getStatus(null)).toBe('auto')
  })

  it('round-trips a set/get', () => {
    setStatus('alice', 'away')
    expect(getStatus('alice')).toBe('away')
    setStatus('alice', 'offline')
    expect(getStatus('alice')).toBe('offline')
  })

  it('scopes status per profile (A does not leak to B)', () => {
    setStatus('alice', 'offline')
    expect(getStatus('alice')).toBe('offline')
    expect(getStatus('bob')).toBe('auto')
  })

  it('ignores invalid status values on write', () => {
    setStatus('alice', 'active')
    setStatus('alice', 'invisible') // not a known value → no-op
    expect(getStatus('alice')).toBe('active')
  })

  it('no-ops a set with a missing profileId', () => {
    setStatus(undefined, 'away')
    expect(getStatus('alice')).toBe('auto')
  })

  it('tolerates a corrupt stored value (falls back to default)', () => {
    globalThis.localStorage.setItem('pe-presence-status-alice', 'garbage-value')
    expect(getStatus('alice')).toBe('auto')
  })

  it('exposes the canonical status values', () => {
    expect(STATUS_VALUES).toEqual(['auto', 'active', 'away', 'offline'])
  })
})

describe('effectiveStatus', () => {
  it('honors an explicit active override even when idle', () => {
    expect(effectiveStatus('active', 'away')).toBe('active')
    expect(effectiveStatus('active', 'offline')).toBe('active')
  })

  it('honors an explicit away override', () => {
    expect(effectiveStatus('away', 'active')).toBe('away')
  })

  it('honors an explicit offline override (appear offline while connected)', () => {
    expect(effectiveStatus('offline', 'active')).toBe('offline')
  })

  it('defers to the automatic signal when override is auto', () => {
    expect(effectiveStatus('auto', 'active')).toBe('active')
    expect(effectiveStatus('auto', 'away')).toBe('away')
    expect(effectiveStatus('auto', 'offline')).toBe('offline')
  })

  it('treats unknown override as auto', () => {
    expect(effectiveStatus(undefined, 'active')).toBe('active')
    expect(effectiveStatus('bogus', 'away')).toBe('away')
  })

  it('falls back to offline when auto and the auto signal is missing/auto', () => {
    expect(effectiveStatus('auto', undefined)).toBe('offline')
    expect(effectiveStatus('auto', 'auto')).toBe('offline')
  })
})

describe('subscribe', () => {
  it('notifies subscribers on change with profileId + value', () => {
    const cb = vi.fn()
    const unsub = subscribe(cb)
    setStatus('alice', 'away')
    expect(cb).toHaveBeenCalledWith({ profileId: 'alice', value: 'away' })
    unsub()
    setStatus('alice', 'active')
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('returns a no-op unsubscriber for a non-function', () => {
    expect(typeof subscribe(null)).toBe('function')
    expect(() => subscribe(null)()).not.toThrow()
  })

  it('isolates a throwing subscriber from the rest', () => {
    const bad = vi.fn(() => { throw new Error('boom') })
    const good = vi.fn()
    subscribe(bad)
    subscribe(good)
    expect(() => setStatus('alice', 'offline')).not.toThrow()
    expect(good).toHaveBeenCalled()
  })
})

import { resolvePresenceMetas } from '../presenceStatus'

describe('resolvePresenceMetas', () => {
  it('returns offline for empty/invalid input', () => {
    expect(resolvePresenceMetas([])).toEqual({ status: 'offline', onlineAt: null })
    expect(resolvePresenceMetas(null)).toEqual({ status: 'offline', onlineAt: null })
  })
  it('is active if ANY tab is active (active-anywhere wins)', () => {
    const metas = [
      { status: 'offline', online_at: '2026-06-19T10:00:00Z' },
      { status: 'active', online_at: '2026-06-19T09:00:00Z' },
    ]
    expect(resolvePresenceMetas(metas).status).toBe('active')
  })
  it('picks away over offline when no active tab', () => {
    expect(resolvePresenceMetas([
      { status: 'offline', online_at: '2026-06-19T10:00:00Z' },
      { status: 'away', online_at: '2026-06-19T09:00:00Z' },
    ]).status).toBe('away')
  })
  it('all tabs away/offline → not active (manual away preserved)', () => {
    expect(resolvePresenceMetas([
      { status: 'away', online_at: '2026-06-19T10:00:00Z' },
      { status: 'away', online_at: '2026-06-19T11:00:00Z' },
    ]).status).toBe('away')
  })
  it('treats missing status field as active (older clients)', () => {
    expect(resolvePresenceMetas([{ online_at: '2026-06-19T10:00:00Z' }]).status).toBe('active')
  })
  it('returns the freshest online_at across metas', () => {
    expect(resolvePresenceMetas([
      { status: 'away', online_at: '2026-06-19T10:00:00Z' },
      { status: 'active', online_at: '2026-06-19T12:00:00Z' },
    ]).onlineAt).toBe('2026-06-19T12:00:00Z')
  })
})
