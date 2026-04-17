import { describe, it, expect } from 'vitest'
import { extractMentionsFromDoc, extractImagesFromDoc } from '../tiptapExtract'

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] }

const mentionDoc = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: 'hey ' },
      { type: 'mention', attrs: { id: 'u1', label: 'Alice' } },
    ],
  }],
}

const dupeMentionDoc = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'u1', label: 'Alice' } }] },
    { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'u1', label: 'Alice' } }] },
    { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 'u2', label: 'Bob' } }] },
  ],
}

const nestedMentionDoc = {
  type: 'doc',
  content: [{
    type: 'bulletList',
    content: [{
      type: 'listItem',
      content: [{
        type: 'paragraph',
        content: [{ type: 'mention', attrs: { id: 'u3', label: 'Carol' } }],
      }],
    }],
  }],
}

const imageDoc = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{
      type: 'image',
      attrs: {
        'data-file-id': 'f1',
        'data-file-name': 'screenshot.png',
        'data-mime': 'image/png',
        src: 'blob:abc',
      },
    }],
  }],
}

const imageNoIdDoc = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [{ type: 'image', attrs: { src: 'https://foo/x.png' } }],
  }],
}

describe('extractMentionsFromDoc', () => {
  it('returns [] for empty doc', () => {
    expect(extractMentionsFromDoc(emptyDoc)).toEqual([])
  })
  it('extracts a single mention', () => {
    expect(extractMentionsFromDoc(mentionDoc)).toEqual([
      { user_id: 'u1', display_name: 'Alice' },
    ])
  })
  it('dedupes repeated mentions by user_id', () => {
    expect(extractMentionsFromDoc(dupeMentionDoc)).toEqual([
      { user_id: 'u1', display_name: 'Alice' },
      { user_id: 'u2', display_name: 'Bob' },
    ])
  })
  it('finds mentions nested in lists', () => {
    expect(extractMentionsFromDoc(nestedMentionDoc)).toEqual([
      { user_id: 'u3', display_name: 'Carol' },
    ])
  })
  it('tolerates null/undefined input', () => {
    expect(extractMentionsFromDoc(null)).toEqual([])
    expect(extractMentionsFromDoc(undefined)).toEqual([])
  })
})

describe('extractImagesFromDoc', () => {
  it('returns [] for empty doc', () => {
    expect(extractImagesFromDoc(emptyDoc)).toEqual([])
  })
  it('extracts an image with data-file-id', () => {
    expect(extractImagesFromDoc(imageDoc)).toEqual([
      { file_id: 'f1', file_name: 'screenshot.png', mime_type: 'image/png', storage_path: null },
    ])
  })
  it('skips images missing data-file-id (external URLs etc.)', () => {
    expect(extractImagesFromDoc(imageNoIdDoc)).toEqual([])
  })
  it('tolerates null/undefined input', () => {
    expect(extractImagesFromDoc(null)).toEqual([])
  })
})
