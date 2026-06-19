// Classify a chat attachment into a coarse "kind" used to pick a renderer:
// inline audio player, PDF preview, inline image, or a typed document card.
//
// Attachment descriptors arrive in a couple of historical shapes. The MIME
// type can live on `mime_type` (chatAttachments.buildAttachmentDescriptor) or
// `type` (older ChatComposer image uploads); the filename on `file_name` or
// `name`. Callers normalize before calling, but we accept missing/blank MIME
// and fall back to the filename extension so classification is robust.
//
// Returns one of: 'audio' | 'pdf' | 'image' | 'doc' | 'sheet' | 'archive' | 'file'

const EXT_KIND = {
  // audio
  mp3: 'audio', m4a: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio',
  aac: 'audio', flac: 'audio', opus: 'audio', weba: 'audio',
  // pdf
  pdf: 'pdf',
  // images
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  bmp: 'image', tiff: 'image', tif: 'image', heic: 'image', heif: 'image',
  avif: 'image',
  // documents
  doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', txt: 'doc', md: 'doc',
  pages: 'doc',
  // slides count as docs (no dedicated icon target)
  ppt: 'doc', pptx: 'doc', odp: 'doc', key: 'doc',
  // spreadsheets
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', tsv: 'sheet', ods: 'sheet',
  numbers: 'sheet',
  // archives
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive',
  gz: 'archive', tgz: 'archive', bz2: 'archive',
}

function extOf(name) {
  if (!name || typeof name !== 'string') return ''
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

export function fileKind(type, name) {
  const mime = (type || '').toLowerCase().trim()

  // MIME is authoritative when present and unambiguous.
  if (mime) {
    if (mime.startsWith('audio/')) return 'audio'
    if (mime === 'application/pdf') return 'pdf'
    // SVG is image/* but is rendered as a download card elsewhere (XSS); we
    // still classify it as 'image' here — the renderer decides whether to
    // inline it. Inline-image safety lives in chatAttachments.isInlineImage.
    if (mime.startsWith('image/')) return 'image'

    if (
      mime === 'application/zip' ||
      mime === 'application/x-zip-compressed' ||
      mime === 'application/x-rar-compressed' ||
      mime === 'application/vnd.rar' ||
      mime === 'application/x-7z-compressed' ||
      mime === 'application/x-tar' ||
      mime === 'application/gzip' ||
      mime === 'application/x-gzip'
    ) {
      return 'archive'
    }

    if (
      mime === 'application/vnd.ms-excel' ||
      mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'application/vnd.oasis.opendocument.spreadsheet' ||
      mime === 'text/csv' ||
      mime === 'text/tab-separated-values'
    ) {
      return 'sheet'
    }

    if (
      mime === 'application/msword' ||
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mime === 'application/vnd.oasis.opendocument.text' ||
      mime === 'application/rtf' ||
      mime === 'application/vnd.ms-powerpoint' ||
      mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
      mime === 'application/vnd.oasis.opendocument.presentation' ||
      mime.startsWith('text/') // text/plain, text/markdown, etc.
    ) {
      return 'doc'
    }
    // Unknown / generic MIME (e.g. application/octet-stream) falls through to
    // the extension check below.
  }

  const byExt = EXT_KIND[extOf(name)]
  if (byExt) return byExt

  return 'file'
}
