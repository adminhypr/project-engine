import { describe, it, expect } from 'vitest'
import { fileKind } from '../fileKind'

describe('fileKind', () => {
  describe('audio', () => {
    it('classifies audio/* MIME', () => {
      expect(fileKind('audio/mpeg', 'song.mp3')).toBe('audio')
      expect(fileKind('audio/wav', 'clip.wav')).toBe('audio')
      expect(fileKind('audio/ogg', 'x.ogg')).toBe('audio')
    })
    it('classifies audio by extension when MIME missing', () => {
      expect(fileKind('', 'voice.m4a')).toBe('audio')
      expect(fileKind(null, 'rec.mp3')).toBe('audio')
      expect(fileKind('application/octet-stream', 'rec.wav')).toBe('audio')
    })
  })

  describe('pdf', () => {
    it('classifies application/pdf', () => {
      expect(fileKind('application/pdf', 'doc.pdf')).toBe('pdf')
    })
    it('classifies pdf by extension', () => {
      expect(fileKind('', 'report.pdf')).toBe('pdf')
      expect(fileKind('application/octet-stream', 'report.PDF')).toBe('pdf')
    })
  })

  describe('image', () => {
    it('classifies image/* MIME', () => {
      expect(fileKind('image/png', 'a.png')).toBe('image')
      expect(fileKind('image/jpeg', 'a.jpg')).toBe('image')
      expect(fileKind('image/gif', 'a.gif')).toBe('image')
      expect(fileKind('image/webp', 'a.webp')).toBe('image')
    })
    it('classifies image by extension', () => {
      expect(fileKind('', 'pic.jpeg')).toBe('image')
      expect(fileKind('', 'pic.HEIC')).toBe('image')
    })
    it('treats svg MIME as image (renderer decides safety)', () => {
      expect(fileKind('image/svg+xml', 'x.svg')).toBe('image')
    })
  })

  describe('doc', () => {
    it('classifies Word / text MIME', () => {
      expect(fileKind('application/msword', 'a.doc')).toBe('doc')
      expect(
        fileKind('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx')
      ).toBe('doc')
      expect(fileKind('text/plain', 'notes.txt')).toBe('doc')
    })
    it('classifies slides as doc', () => {
      expect(fileKind('application/vnd.ms-powerpoint', 'deck.ppt')).toBe('doc')
      expect(fileKind('', 'deck.pptx')).toBe('doc')
    })
    it('classifies doc by extension', () => {
      expect(fileKind('', 'a.docx')).toBe('doc')
      expect(fileKind('application/octet-stream', 'a.rtf')).toBe('doc')
    })
  })

  describe('sheet', () => {
    it('classifies Excel / CSV MIME', () => {
      expect(fileKind('application/vnd.ms-excel', 'a.xls')).toBe('sheet')
      expect(
        fileKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx')
      ).toBe('sheet')
      expect(fileKind('text/csv', 'data.csv')).toBe('sheet')
    })
    it('classifies sheet by extension', () => {
      expect(fileKind('', 'a.xlsx')).toBe('sheet')
      expect(fileKind('application/octet-stream', 'a.csv')).toBe('sheet')
    })
  })

  describe('archive', () => {
    it('classifies zip / rar MIME', () => {
      expect(fileKind('application/zip', 'a.zip')).toBe('archive')
      expect(fileKind('application/x-7z-compressed', 'a.7z')).toBe('archive')
    })
    it('classifies archive by extension', () => {
      expect(fileKind('', 'a.zip')).toBe('archive')
      expect(fileKind('application/octet-stream', 'a.tar')).toBe('archive')
      expect(fileKind('', 'a.7z')).toBe('archive')
    })
  })

  describe('fallback', () => {
    it('returns file for unknown MIME + unknown extension', () => {
      expect(fileKind('application/octet-stream', 'binary.bin')).toBe('file')
      expect(fileKind('', 'noext')).toBe('file')
    })
    it('returns file for missing type and name', () => {
      expect(fileKind()).toBe('file')
      expect(fileKind(null, null)).toBe('file')
      expect(fileKind('', '')).toBe('file')
    })
    it('handles names with no usable extension', () => {
      expect(fileKind('', 'trailing.')).toBe('file')
      expect(fileKind('', '.hidden')).toBe('file')
    })
  })

  describe('MIME wins over extension when both present', () => {
    it('audio MIME beats a misleading .txt name', () => {
      expect(fileKind('audio/mpeg', 'weird.txt')).toBe('audio')
    })
  })
})
