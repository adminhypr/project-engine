// Shared logic for chat file attachments (campfire + widget DMs/groups/
// task chats). Files upload to the `dm-attachments` bucket; raster images
// route into the existing inline-image flow (rendered inline), everything
// else — including SVG — routes into the `attachments` array and renders
// as a forced-download chip. See docs/plans/2026-06-15-chat-file-attachments-design.md.

// Raster image types that are SAFE to render inline via an <img> signed
// URL. SVG is deliberately EXCLUDED — it can embed <script>, so it must
// travel as a download chip, never an inline preview.
const INLINE_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/avif',
  'image/bmp',
  'image/tiff',
])

const FILENAME_MAX = 80

// True when a file should preview inline (raster image). Anything else —
// docs, archives, audio, video, and crucially SVG/HTML — returns false and
// becomes a download chip.
export function isInlineImage(mime) {
  return INLINE_IMAGE_MIME.has((mime || '').toLowerCase())
}

// Strip path/script-unfriendly characters and clamp length while keeping
// the extension. Mirrors the card FileAttachments sanitizer so storage
// object names stay predictable.
export function sanitizeFilename(name) {
  const base = (name || 'file').replace(/[^A-Za-z0-9._-]/g, '_')
  if (base.length <= FILENAME_MAX) return base
  const dot = base.lastIndexOf('.')
  if (dot > 0 && dot >= base.length - 12) {
    const ext = base.slice(dot)
    return base.slice(0, FILENAME_MAX - ext.length) + ext
  }
  return base.slice(0, FILENAME_MAX)
}

// Storage path for a chat attachment. The dm-attachments RLS keys on the
// FIRST folder segment being the conversation id, so it MUST lead.
export function attachmentStoragePath(conversationId, uuid, fileName) {
  return `${conversationId}/${uuid}/${sanitizeFilename(fileName)}`
}

// Build the descriptor persisted in dm_messages.attachments. Shape matches
// the card FileAttachments convention so RichContentRenderer stays uniform.
export function buildAttachmentDescriptor({ storage_path, file, mime_type, size }) {
  return {
    storage_path,
    file_name: sanitizeFilename(file?.name || 'file'),
    mime_type: mime_type || file?.type || 'application/octet-stream',
    size: size != null ? size : file?.size ?? null,
  }
}

export function formatFileSize(bytes) {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
