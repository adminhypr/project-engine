import { describe, it, expect } from 'vitest'
import { replaceEmoticons } from '../emoticons'

describe('replaceEmoticons', () => {
  it('passes empty / non-string inputs through', () => {
    expect(replaceEmoticons('')).toBe('')
    expect(replaceEmoticons(null)).toBe(null)
    expect(replaceEmoticons(undefined)).toBe(undefined)
  })

  it('replaces common smileys at end of string', () => {
    expect(replaceEmoticons('ok i can see you now :D')).toBe('ok i can see you now 😄')
    expect(replaceEmoticons('hi :)')).toBe('hi 🙂')
    expect(replaceEmoticons('nope :(')).toBe('nope 😞')
    expect(replaceEmoticons('wink ;)')).toBe('wink 😉')
    expect(replaceEmoticons('love you <3')).toBe('love you ❤️')
  })

  it('preserves surrounding whitespace and punctuation', () => {
    expect(replaceEmoticons('hey :) how are you')).toBe('hey 🙂 how are you')
    expect(replaceEmoticons('whoa :O,')).toBe('whoa 😮,')
    expect(replaceEmoticons('done :D.')).toBe('done 😄.')
  })

  it('picks longer tokens over shorter prefixes', () => {
    expect(replaceEmoticons(":'(")).toBe('😢')
    expect(replaceEmoticons(":'( sad day")).toBe('😢 sad day')
    expect(replaceEmoticons(':-D rolling')).toBe('😄 rolling')
  })

  it('does not match inside words or after non-whitespace', () => {
    expect(replaceEmoticons(':Dark mode')).toBe(':Dark mode')
    expect(replaceEmoticons('D:\\path')).toBe('D:\\path')
    expect(replaceEmoticons('foo:D')).toBe('foo:D')
  })

  it('does not mangle URLs', () => {
    // ":/" inside http:// has no leading whitespace and is followed by "/"
    // which isn't in our trailing punctuation set, so nothing matches.
    expect(replaceEmoticons('visit http://example.com')).toBe('visit http://example.com')
    expect(replaceEmoticons('port :3000 is open')).toBe('port :3000 is open')
  })

  it('handles multiple emoticons in one message', () => {
    expect(replaceEmoticons('hi :) and bye :(')).toBe('hi 🙂 and bye 😞')
    expect(replaceEmoticons(';) xD :D')).toBe('😉 😆 😄')
  })

  it('treats xD case-sensitively (XD also works)', () => {
    expect(replaceEmoticons('lol xD')).toBe('lol 😆')
    expect(replaceEmoticons('lol XD')).toBe('lol 😆')
  })
})
