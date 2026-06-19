import { describe, it, expect } from 'vitest'
import {
  WALLPAPER_PRESETS,
  getPresetByKey,
  parseWallpaper,
  resolveWallpaperBackground,
} from '../chatWallpaper'

describe('WALLPAPER_PRESETS', () => {
  it('exposes exactly 5 neon presets', () => {
    expect(WALLPAPER_PRESETS).toHaveLength(6)
  })

  it('every preset has a unique key, a label, and a non-empty background', () => {
    const keys = new Set()
    for (const p of WALLPAPER_PRESETS) {
      expect(typeof p.key).toBe('string')
      expect(p.key.length).toBeGreaterThan(0)
      expect(typeof p.label).toBe('string')
      expect(p.label.length).toBeGreaterThan(0)
      expect(typeof p.background).toBe('string')
      expect(p.background).toMatch(/gradient/)
      keys.add(p.key)
    }
    expect(keys.size).toBe(WALLPAPER_PRESETS.length)
  })

  it('getPresetByKey resolves a known key and returns null for unknown', () => {
    expect(getPresetByKey('neon-aurora')).toBeTruthy()
    expect(getPresetByKey('nope')).toBeNull()
  })
})

describe('parseWallpaper', () => {
  it('parses preset and upload schemes', () => {
    expect(parseWallpaper('preset:neon-aurora')).toEqual({ type: 'preset', value: 'neon-aurora' })
    expect(parseWallpaper('upload:abc/wallpaper/x.jpg')).toEqual({ type: 'upload', value: 'abc/wallpaper/x.jpg' })
  })

  it('returns null for null, empty, scheme-less, and unknown schemes', () => {
    expect(parseWallpaper(null)).toBeNull()
    expect(parseWallpaper('')).toBeNull()
    expect(parseWallpaper('justtext')).toBeNull()
    expect(parseWallpaper(':leading')).toBeNull()
    expect(parseWallpaper('weird:value')).toBeNull()
    expect(parseWallpaper('preset:')).toBeNull()
    expect(parseWallpaper(42)).toBeNull()
  })
})

describe('resolveWallpaperBackground', () => {
  it('resolves a preset to its gradient', () => {
    const aurora = WALLPAPER_PRESETS.find((p) => p.key === 'neon-aurora')
    expect(resolveWallpaperBackground('preset:neon-aurora')).toBe(aurora.background)
  })

  it('returns null for an unknown preset key', () => {
    expect(resolveWallpaperBackground('preset:does-not-exist')).toBeNull()
  })

  it('resolves an upload to a url() background when a signed URL is provided', () => {
    const bg = resolveWallpaperBackground('upload:cid/wallpaper/x.jpg', 'https://signed.example/x.jpg')
    expect(bg).toBe('url("https://signed.example/x.jpg") center / cover no-repeat')
  })

  it('returns null for an upload without a signed URL', () => {
    expect(resolveWallpaperBackground('upload:cid/wallpaper/x.jpg')).toBeNull()
    expect(resolveWallpaperBackground('upload:cid/wallpaper/x.jpg', null)).toBeNull()
  })

  it('returns null for null / unknown values', () => {
    expect(resolveWallpaperBackground(null)).toBeNull()
    expect(resolveWallpaperBackground('garbage')).toBeNull()
    expect(resolveWallpaperBackground('')).toBeNull()
  })
})
