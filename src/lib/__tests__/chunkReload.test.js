import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isChunkLoadError, reloadOnceForStaleChunk } from '../chunkReload'

describe('isChunkLoadError', () => {
  it('matches Vite preload failures', () => {
    expect(isChunkLoadError(new Error(
      'Failed to fetch dynamically imported module: https://x.com/assets/TeamChatPage-CRh2RiPg.js'
    ))).toBe(true)
  })

  it('matches Safari/Chrome import script failures', () => {
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
  })

  it('matches webpack-style ChunkLoadError', () => {
    const err = new Error('Loading chunk 42 failed.')
    err.name = 'ChunkLoadError'
    expect(isChunkLoadError(err)).toBe(true)
  })

  it('matches the "Loading chunk N failed" message even without the name', () => {
    expect(isChunkLoadError(new Error('Loading chunk vendor-abc failed.'))).toBe(true)
  })

  it('matches the "error loading dynamically imported module" variant', () => {
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false)
    expect(isChunkLoadError(new Error('Network request failed'))).toBe(false)
  })

  it('returns false for null / undefined', () => {
    expect(isChunkLoadError(null)).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })
})

describe('reloadOnceForStaleChunk', () => {
  let reloadSpy

  beforeEach(() => {
    sessionStorage.clear()
    // jsdom's location.reload throws "not implemented" — replace it.
    reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    })
  })

  it('reloads on first call', () => {
    expect(reloadOnceForStaleChunk('test')).toBe(true)
    expect(reloadSpy).toHaveBeenCalledOnce()
  })

  it('suppresses a second call within the cooldown window', () => {
    reloadOnceForStaleChunk('first')
    reloadSpy.mockClear()
    expect(reloadOnceForStaleChunk('second')).toBe(false)
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('allows a reload again once the cooldown stamp is older than the window', () => {
    // Pretend the previous reload happened 11s ago.
    sessionStorage.setItem('pe-chunk-reload-at', String(Date.now() - 11_000))
    expect(reloadOnceForStaleChunk('post-cooldown')).toBe(true)
    expect(reloadSpy).toHaveBeenCalledOnce()
  })

  it('persists the reload timestamp into sessionStorage', () => {
    const before = Date.now()
    reloadOnceForStaleChunk('persist')
    const stored = Number(sessionStorage.getItem('pe-chunk-reload-at'))
    expect(stored).toBeGreaterThanOrEqual(before)
  })
})
