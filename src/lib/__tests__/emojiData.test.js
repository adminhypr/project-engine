import { describe, it, expect } from 'vitest'
import { EMOJI_CATEGORIES, searchEmojis } from '../emojiData'

describe('emojiData', () => {
  it('has multiple non-empty categories', () => {
    expect(EMOJI_CATEGORIES.length).toBeGreaterThanOrEqual(8)
    for (const cat of EMOJI_CATEGORIES) {
      expect(cat.id).toBeTruthy()
      expect(cat.label).toBeTruthy()
      expect(Array.isArray(cat.emojis)).toBe(true)
      expect(cat.emojis.length).toBeGreaterThan(0)
    }
  })

  it('has a reasonable total count (a few hundred, not the full unicode set)', () => {
    const total = EMOJI_CATEGORIES.reduce((n, c) => n + c.emojis.length, 0)
    expect(total).toBeGreaterThanOrEqual(250)
    expect(total).toBeLessThanOrEqual(600)
  })

  it('every emoji has a char, name, and keywords array', () => {
    for (const cat of EMOJI_CATEGORIES) {
      for (const e of cat.emojis) {
        expect(typeof e.char).toBe('string')
        expect(e.char.length).toBeGreaterThan(0)
        expect(typeof e.name).toBe('string')
        expect(e.name.length).toBeGreaterThan(0)
        expect(Array.isArray(e.keywords)).toBe(true)
      }
    }
  })

  it('searchEmojis finds by name (case-insensitive)', () => {
    const res = searchEmojis('Rocket')
    expect(res.some(e => e.char === '🚀')).toBe(true)
  })

  it('searchEmojis finds by keyword', () => {
    const res = searchEmojis('thumbs')
    expect(res.some(e => e.char === '👍')).toBe(true)
  })

  it('searchEmojis matches substrings across multiple results', () => {
    const res = searchEmojis('heart')
    expect(res.length).toBeGreaterThan(1)
    expect(res.some(e => e.char === '❤️')).toBe(true)
  })

  it('searchEmojis returns nothing for empty / whitespace query', () => {
    expect(searchEmojis('')).toEqual([])
    expect(searchEmojis('   ')).toEqual([])
    expect(searchEmojis(null)).toEqual([])
  })

  it('searchEmojis de-duplicates results by char', () => {
    const res = searchEmojis('check')
    const chars = res.map(e => e.char)
    expect(new Set(chars).size).toBe(chars.length)
  })
})
