import { describe, it, expect } from 'vitest'
import { deriveMedia } from '../../hooks/useConversationMedia'

function msg(overrides) {
  return {
    id: 'm1',
    author_id: 'u1',
    created_at: '2026-06-19T10:00:00Z',
    content: '',
    inline_images: null,
    attachments: null,
    author: { id: 'u1', full_name: 'Alice' },
    ...overrides,
  }
}

describe('deriveMedia — files', () => {
  it('returns empty arrays for empty / nullish input', () => {
    expect(deriveMedia([])).toEqual({ files: [], links: [] })
    expect(deriveMedia(null)).toEqual({ files: [], links: [] })
    expect(deriveMedia([null, undefined])).toEqual({ files: [], links: [] })
  })

  it('flattens inline_images as images regardless of MIME', () => {
    const { files } = deriveMedia([
      msg({
        inline_images: [
          { storage_path: 'c/1/a.png', name: 'a.png', size: 10, type: 'image/png', bucket: 'dm-attachments' },
        ],
      }),
    ])
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      storage_path: 'c/1/a.png',
      name: 'a.png',
      isImage: true,
      bucket: 'dm-attachments',
      authorName: 'Alice',
      messageId: 'm1',
    })
  })

  it('treats attachments with image/* MIME as images, others as files', () => {
    const { files } = deriveMedia([
      msg({
        attachments: [
          { storage_path: 'c/2/pic.jpg', file_name: 'pic.jpg', mime_type: 'image/jpeg', size: 20 },
          { storage_path: 'c/2/doc.pdf', file_name: 'doc.pdf', mime_type: 'application/pdf', size: 30 },
        ],
      }),
    ])
    expect(files).toHaveLength(2)
    const pic = files.find(f => f.storage_path === 'c/2/pic.jpg')
    const doc = files.find(f => f.storage_path === 'c/2/doc.pdf')
    expect(pic.isImage).toBe(true)
    expect(doc.isImage).toBe(false)
    expect(doc.name).toBe('doc.pdf')
  })

  it('defaults bucket to dm-attachments and tolerates missing fields', () => {
    const { files } = deriveMedia([
      msg({ attachments: [{ storage_path: 'c/3/x.txt' }] }),
    ])
    expect(files[0]).toMatchObject({ bucket: 'dm-attachments', size: null, isImage: false })
  })

  it('skips entries without a storage path', () => {
    const { files } = deriveMedia([
      msg({ inline_images: [{ name: 'no-path.png' }], attachments: [{}] }),
    ])
    expect(files).toEqual([])
  })
})

describe('deriveMedia — links', () => {
  it('extracts http(s) URLs from content', () => {
    const { links } = deriveMedia([
      msg({ content: 'see https://example.com/path and http://foo.io' }),
    ])
    expect(links.map(l => l.url)).toEqual([
      'https://example.com/path',
      'http://foo.io',
    ])
    expect(links[0]).toMatchObject({ authorName: 'Alice', messageId: 'm1' })
  })

  it('prepends https:// to bare / www links via normalizeUrlMatch', () => {
    const { links } = deriveMedia([msg({ content: 'visit www.example.com today' })])
    expect(links[0].url).toBe('https://www.example.com')
  })

  it('dedupes identical url+message but keeps same url across messages', () => {
    const { links } = deriveMedia([
      msg({ id: 'a', content: 'https://x.com https://x.com' }),
      msg({ id: 'b', content: 'https://x.com' }),
    ])
    expect(links).toHaveLength(2)
    expect(links.every(l => l.url === 'https://x.com')).toBe(true)
  })

  it('produces no links for content without URLs', () => {
    const { links } = deriveMedia([msg({ content: 'just plain text v1.2.3' })])
    expect(links).toEqual([])
  })
})
