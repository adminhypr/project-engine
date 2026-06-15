import { describe, it, expect } from 'vitest'
import {
  isInlineImage,
  sanitizeFilename,
  attachmentStoragePath,
  buildAttachmentDescriptor,
  formatFileSize,
} from '../chatAttachments'

describe('isInlineImage', () => {
  it('routes raster images inline', () => {
    expect(isInlineImage('image/png')).toBe(true)
    expect(isInlineImage('image/jpeg')).toBe(true)
    expect(isInlineImage('image/webp')).toBe(true)
    expect(isInlineImage('image/gif')).toBe(true)
  })
  it('is case-insensitive', () => {
    expect(isInlineImage('IMAGE/PNG')).toBe(true)
  })
  it('never routes SVG inline (XSS-capable → must be a download chip)', () => {
    expect(isInlineImage('image/svg+xml')).toBe(false)
    expect(isInlineImage('image/svg')).toBe(false)
  })
  it('routes non-images as chips', () => {
    expect(isInlineImage('application/pdf')).toBe(false)
    expect(isInlineImage('text/html')).toBe(false)
    expect(isInlineImage('application/zip')).toBe(false)
    expect(isInlineImage('video/mp4')).toBe(false)
  })
  it('handles missing/empty mime', () => {
    expect(isInlineImage('')).toBe(false)
    expect(isInlineImage(undefined)).toBe(false)
    expect(isInlineImage(null)).toBe(false)
  })
})

describe('sanitizeFilename', () => {
  it('replaces unsafe characters with underscores', () => {
    expect(sanitizeFilename('my file (1).pdf')).toBe('my_file__1_.pdf')
    expect(sanitizeFilename('../../etc/passwd')).toBe('.._.._etc_passwd')
  })
  it('falls back when name missing', () => {
    expect(sanitizeFilename('')).toBe('file')
    expect(sanitizeFilename(undefined)).toBe('file')
  })
  it('clamps long names but keeps the extension', () => {
    const long = 'a'.repeat(200) + '.pdf'
    const out = sanitizeFilename(long)
    expect(out.length).toBe(80)
    expect(out.endsWith('.pdf')).toBe(true)
  })
  it('clamps long names with no short extension by raw slice', () => {
    const long = 'a'.repeat(200)
    expect(sanitizeFilename(long).length).toBe(80)
  })
})

describe('attachmentStoragePath', () => {
  it('leads with the conversation id (required by dm-attachments RLS)', () => {
    const p = attachmentStoragePath('conv-123', 'uuid-9', 'report.pdf')
    expect(p).toBe('conv-123/uuid-9/report.pdf')
    expect(p.split('/')[0]).toBe('conv-123')
  })
  it('sanitizes the filename segment', () => {
    expect(attachmentStoragePath('c', 'u', 'a b.txt')).toBe('c/u/a_b.txt')
  })
})

describe('buildAttachmentDescriptor', () => {
  it('produces the persisted shape from a File', () => {
    const file = { name: 'notes final.pdf', type: 'application/pdf', size: 2048 }
    expect(buildAttachmentDescriptor({ storage_path: 'c/u/notes_final.pdf', file })).toEqual({
      storage_path: 'c/u/notes_final.pdf',
      file_name: 'notes_final.pdf',
      mime_type: 'application/pdf',
      size: 2048,
    })
  })
  it('falls back to octet-stream when type unknown', () => {
    const file = { name: 'thing.xyz', type: '', size: 1 }
    expect(buildAttachmentDescriptor({ storage_path: 'p', file }).mime_type).toBe('application/octet-stream')
  })
})

describe('formatFileSize', () => {
  it('formats bytes/KB/MB', () => {
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(2048)).toBe('2.0 KB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
  it('returns empty string for null', () => {
    expect(formatFileSize(null)).toBe('')
  })
})
