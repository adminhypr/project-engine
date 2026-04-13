import { describe, it, expect } from 'vitest'
import { parseMentionQuery, insertMention, buildMentionSegments } from '../mentions'

describe('parseMentionQuery', () => {
  it('returns inactive when no @ present', () => {
    const result = parseMentionQuery('hello world', 11)
    expect(result.active).toBe(false)
  })

  it('detects @ at start of text', () => {
    const result = parseMentionQuery('@jan', 4)
    expect(result).toEqual({ active: true, query: 'jan', startIndex: 0 })
  })

  it('detects @ after a space', () => {
    const result = parseMentionQuery('hey @bob', 8)
    expect(result).toEqual({ active: true, query: 'bob', startIndex: 4 })
  })

  it('detects @ after a newline', () => {
    const result = parseMentionQuery('line1\n@al', 9)
    expect(result).toEqual({ active: true, query: 'al', startIndex: 6 })
  })

  it('returns inactive when @ is mid-word', () => {
    const result = parseMentionQuery('email@test', 10)
    expect(result.active).toBe(false)
  })

  it('returns inactive when cursor is before @', () => {
    const result = parseMentionQuery('hello @bob', 3)
    expect(result.active).toBe(false)
  })

  it('returns inactive when space follows @query', () => {
    const result = parseMentionQuery('@bob is here', 12)
    expect(result.active).toBe(false)
  })

  it('returns empty query for bare @', () => {
    const result = parseMentionQuery('hey @', 5)
    expect(result).toEqual({ active: true, query: '', startIndex: 4 })
  })
})

describe('insertMention', () => {
  it('replaces @query with @DisplayName and trailing space', () => {
    const result = insertMention('hey @bo', 7, 'Bob Smith')
    expect(result.newText).toBe('hey @Bob Smith ')
    expect(result.newCursorPosition).toBe(15)
  })

  it('works at start of text', () => {
    const result = insertMention('@ja', 3, 'Jane Doe')
    expect(result.newText).toBe('@Jane Doe ')
    expect(result.newCursorPosition).toBe(10)
  })

  it('preserves text after cursor', () => {
    const result = insertMention('@bo and others', 3, 'Bob Smith')
    expect(result.newText).toBe('@Bob Smith and others')
  })
})

describe('buildMentionSegments', () => {
  it('returns single text segment when no mentions', () => {
    const result = buildMentionSegments('hello world', [])
    expect(result).toEqual([{ type: 'text', value: 'hello world' }])
  })

  it('splits text around a mention', () => {
    const result = buildMentionSegments('hey @Jane Smith check this', [
      { user_id: '123', display_name: 'Jane Smith' }
    ])
    expect(result).toEqual([
      { type: 'text', value: 'hey ' },
      { type: 'mention', value: '@Jane Smith', user_id: '123', display_name: 'Jane Smith' },
      { type: 'text', value: ' check this' },
    ])
  })

  it('handles multiple mentions', () => {
    const result = buildMentionSegments('@Alice and @Bob', [
      { user_id: 'a', display_name: 'Alice' },
      { user_id: 'b', display_name: 'Bob' },
    ])
    expect(result).toEqual([
      { type: 'mention', value: '@Alice', user_id: 'a', display_name: 'Alice' },
      { type: 'text', value: ' and ' },
      { type: 'mention', value: '@Bob', user_id: 'b', display_name: 'Bob' },
    ])
  })

  it('ignores @Name not in mentions array', () => {
    const result = buildMentionSegments('hey @Ghost', [])
    expect(result).toEqual([{ type: 'text', value: 'hey @Ghost' }])
  })

  it('handles mention at end of text', () => {
    const result = buildMentionSegments('hello @Jane Smith', [
      { user_id: '1', display_name: 'Jane Smith' }
    ])
    expect(result).toEqual([
      { type: 'text', value: 'hello ' },
      { type: 'mention', value: '@Jane Smith', user_id: '1', display_name: 'Jane Smith' },
    ])
  })
})
