// Shared client-side upload guards. The hub-files bucket allow-list
// (migration 077) is the authoritative gate; these helpers exist to
// reject obvious risk types early with a clear UX message instead of
// a generic "upload failed" toast.

// Script-capable image types — SVG can embed <script> that executes
// when opened via a signed URL.
const BLOCKED_IMAGE_MIME = new Set(['image/svg+xml', 'image/svg'])

export function isBlockedImageType(file) {
  return BLOCKED_IMAGE_MIME.has(file?.type)
}
