import { describe, it, expect } from 'vitest'
import { parseBlocks, INLINE_MD_RE_SOURCE, INLINE_MD_FLAGS } from '../linkify'

// Helper: run the inline regex over a string and return an array describing
// each match by which capture group fired. Mirrors the consumer logic in
// RichContentRenderer.renderInlineMarkdown without the JSX.
function inlineMatches(text) {
  const re = new RegExp(INLINE_MD_RE_SOURCE, INLINE_MD_FLAGS)
  const out = []
  let m
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) out.push(['bold', m[1]])
    else if (m[2] !== undefined) out.push(['italic', m[2]])
    else if (m[3] !== undefined) out.push(['link', m[3], m[4]])
    else if (m[5] !== undefined) out.push(['url', m[5]])
    else if (m[6] !== undefined) out.push(['strike', m[6]])
    else if (m[7] !== undefined) out.push(['code', m[7]])
  }
  return out
}

describe('inline markdown regex — strikethrough', () => {
  it('matches ~~strikethrough~~', () => {
    expect(inlineMatches('a ~~gone~~ b')).toEqual([['strike', 'gone']])
  })
  it('composes with bold and italic', () => {
    expect(inlineMatches('**b** _i_ ~~s~~')).toEqual([
      ['bold', 'b'],
      ['italic', 'i'],
      ['strike', 's'],
    ])
  })
  it('does NOT treat a lone ~ as strikethrough', () => {
    expect(inlineMatches('about ~5 minutes')).toEqual([])
  })
  it('does NOT treat a single ~pair~ as strikethrough', () => {
    expect(inlineMatches('a ~one~ b')).toEqual([])
  })
})

describe('inline markdown regex — inline code', () => {
  it('matches `code`', () => {
    expect(inlineMatches('run `npm test` now')).toEqual([['code', 'npm test']])
  })
  it('keeps markdown inside inline code literal (code wins)', () => {
    // The bold/strike markers inside the backticks must NOT produce separate
    // matches — the whole span is consumed as one literal code token.
    expect(inlineMatches('`**bold** ~~x~~`')).toEqual([['code', '**bold** ~~x~~']])
  })
  it('does NOT treat a single backtick in prose as code', () => {
    expect(inlineMatches("it's a backtick ` here")).toEqual([])
  })
})

describe('parseBlocks — paragraphs', () => {
  it('treats plain text as a single paragraph block', () => {
    expect(parseBlocks('hello world')).toEqual([
      { type: 'p', lines: ['hello world'] },
    ])
  })
  it('groups consecutive plain lines into one paragraph block', () => {
    expect(parseBlocks('line one\nline two')).toEqual([
      { type: 'p', lines: ['line one', 'line two'] },
    ])
  })
})

describe('parseBlocks — fenced code blocks', () => {
  it('parses a ```-fenced code block, content is literal', () => {
    const blocks = parseBlocks('```\nconst x = **1**\n```')
    expect(blocks).toEqual([{ type: 'code', code: 'const x = **1**' }])
  })
  it('keeps text before and after a fenced block as paragraphs', () => {
    const blocks = parseBlocks('before\n```\ncode\n```\nafter')
    expect(blocks).toEqual([
      { type: 'p', lines: ['before'] },
      { type: 'code', code: 'code' },
      { type: 'p', lines: ['after'] },
    ])
  })
  it('preserves blank/multiple lines inside a fence', () => {
    const blocks = parseBlocks('```\nline1\n\nline2\n```')
    expect(blocks).toEqual([{ type: 'code', code: 'line1\n\nline2' }])
  })
})

describe('parseBlocks — blockquotes', () => {
  it('groups consecutive "> " lines into one blockquote', () => {
    const blocks = parseBlocks('> first\n> second')
    expect(blocks).toEqual([{ type: 'quote', lines: ['first', 'second'] }])
  })
  it('does NOT treat a mid-line > as a blockquote', () => {
    const blocks = parseBlocks('two > three')
    expect(blocks).toEqual([{ type: 'p', lines: ['two > three'] }])
  })
})

describe('parseBlocks — lists', () => {
  it('groups "- " lines into a bulleted list', () => {
    const blocks = parseBlocks('- a\n- b')
    expect(blocks).toEqual([{ type: 'ul', items: ['a', 'b'] }])
  })
  it('groups "* " lines into a bulleted list too', () => {
    const blocks = parseBlocks('* a\n* b')
    expect(blocks).toEqual([{ type: 'ul', items: ['a', 'b'] }])
  })
  it('groups "1. " lines into an ordered list', () => {
    const blocks = parseBlocks('1. a\n2. b')
    expect(blocks).toEqual([{ type: 'ol', items: ['a', 'b'] }])
  })
  it('does NOT treat a hyphen mid-word as a bullet', () => {
    expect(parseBlocks('well-known fact')).toEqual([
      { type: 'p', lines: ['well-known fact'] },
    ])
  })
  it('separates a bulleted list from a following paragraph', () => {
    const blocks = parseBlocks('- a\n- b\nplain')
    expect(blocks).toEqual([
      { type: 'ul', items: ['a', 'b'] },
      { type: 'p', lines: ['plain'] },
    ])
  })
})
