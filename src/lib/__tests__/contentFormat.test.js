import { describe, it, expect } from 'vitest'
import { isHtmlContent } from '../contentFormat'

describe('isHtmlContent', () => {
  it('returns false for empty string', () => {
    expect(isHtmlContent('')).toBe(false)
  })
  it('returns false for plain text', () => {
    expect(isHtmlContent('hello world')).toBe(false)
  })
  it('returns false for markdown-style text', () => {
    expect(isHtmlContent('**bold** and _italic_')).toBe(false)
  })
  it('returns false for inline comparison text', () => {
    expect(isHtmlContent('two < three')).toBe(false)
  })
  it('returns false for non-whitelisted root tags (e.g., script)', () => {
    expect(isHtmlContent('<script>evil</script>')).toBe(false)
  })
  it('returns false for null / undefined', () => {
    expect(isHtmlContent(null)).toBe(false)
    expect(isHtmlContent(undefined)).toBe(false)
  })
  it('returns true for a paragraph-rooted doc', () => {
    expect(isHtmlContent('<p>hi</p>')).toBe(true)
  })
  it('returns true with leading whitespace', () => {
    expect(isHtmlContent('  \n  <ul><li>a</li></ul>')).toBe(true)
  })
  it('returns true for heading-rooted doc', () => {
    expect(isHtmlContent('<h2>title</h2>')).toBe(true)
  })
  it('returns true for blockquote-rooted doc', () => {
    expect(isHtmlContent('<blockquote>q</blockquote>')).toBe(true)
  })
})
