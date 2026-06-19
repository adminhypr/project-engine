import { describe, it, expect } from 'vitest'
import { normalizeGif } from '../giphy'

function rawGif(overrides = {}) {
  return {
    id: 'abc123',
    title: 'happy dance',
    images: {
      fixed_width: { url: 'https://media.giphy.com/fw.gif?cid=1', width: '200', height: '150' },
      downsized: { url: 'https://media.giphy.com/ds.gif?cid=1' },
      downsized_medium: { url: 'https://media.giphy.com/dm.gif?cid=1' },
      original: { url: 'https://media.giphy.com/orig.gif?cid=1' },
    },
    ...overrides,
  }
}

describe('normalizeGif', () => {
  it('maps the standard renditions', () => {
    const g = normalizeGif(rawGif())
    expect(g).toEqual({
      id: 'abc123',
      title: 'happy dance',
      previewUrl: 'https://media.giphy.com/fw.gif?cid=1',
      sendUrl: 'https://media.giphy.com/ds.gif?cid=1',
      width: 200,
      height: 150,
    })
  })

  it('preserves CDN query params (ToS: do not strip)', () => {
    const g = normalizeGif(rawGif())
    expect(g.previewUrl).toContain('?cid=1')
    expect(g.sendUrl).toContain('?cid=1')
  })

  it('falls back to downsized_medium when downsized is missing', () => {
    const raw = rawGif()
    delete raw.images.downsized
    const g = normalizeGif(raw)
    expect(g.sendUrl).toBe('https://media.giphy.com/dm.gif?cid=1')
  })

  it('falls back to original when both downsized renditions are missing', () => {
    const raw = rawGif()
    delete raw.images.downsized
    delete raw.images.downsized_medium
    const g = normalizeGif(raw)
    expect(g.sendUrl).toBe('https://media.giphy.com/orig.gif?cid=1')
  })

  it('defaults title to "GIF" when absent', () => {
    const raw = rawGif({ title: '' })
    expect(normalizeGif(raw).title).toBe('GIF')
  })

  it('omits width/height when fixed_width dimensions are non-numeric', () => {
    const raw = rawGif()
    raw.images.fixed_width = { url: 'https://media.giphy.com/fw.gif' }
    const g = normalizeGif(raw)
    expect(g.width).toBeUndefined()
    expect(g.height).toBeUndefined()
    expect(g.previewUrl).toBe('https://media.giphy.com/fw.gif')
  })

  it('uses preview_gif/original for previewUrl when fixed_width is missing', () => {
    const raw = rawGif()
    delete raw.images.fixed_width
    raw.images.preview_gif = { url: 'https://media.giphy.com/pg.gif' }
    const g = normalizeGif(raw)
    expect(g.previewUrl).toBe('https://media.giphy.com/pg.gif')
  })

  it('returns null for missing id', () => {
    expect(normalizeGif({ images: {} })).toBeNull()
    expect(normalizeGif(null)).toBeNull()
  })

  it('returns null when no usable image renditions exist', () => {
    expect(normalizeGif({ id: 'x', images: {} })).toBeNull()
  })
})
