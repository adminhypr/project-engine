-- ─────────────────────────────────────────────
-- 077 · MIME allow-list on hub-files bucket
--
-- The hub-files bucket holds inline RichInput / TodoEditor images,
-- general docs/files (useHubFiles), and card attachments
-- (FileAttachments). Without an allowed_mime_types restriction, an SVG
-- with embedded <script> uploaded as an "image" passes the client-side
-- file.type.startsWith('image/') check and executes XSS when opened
-- via signed URL. Same risk for HTML/XML.
--
-- This migration sets an explicit allow-list covering all current
-- legitimate uploads (images, common office docs, archives, audio,
-- video, plain text, markdown, csv) and excludes script-capable types
-- (SVG, HTML, XHTML, XML, JS).
--
-- Defense in depth: see the matching client-side reject in
-- src/components/ui/RichInput.jsx (BLOCKED_IMAGE_MIME).
--
-- NOTE: application/octet-stream IS in the list because
-- FileAttachments.jsx falls back to it when the browser doesn't
-- recognize the file's MIME type. Without it, common attachments with
-- unusual extensions would fail. The trade-off is that storage will
-- accept any binary blob — but the hub_id-scoped storage RLS from
-- migration 073 means only hub members can read those files anyway.
-- ─────────────────────────────────────────────

update storage.buckets
   set allowed_mime_types = array[
     -- Images (NO svg — script-capable)
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

     -- Documents
     'application/pdf',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.ms-powerpoint',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     'application/vnd.oasis.opendocument.text',
     'application/vnd.oasis.opendocument.spreadsheet',
     'application/vnd.oasis.opendocument.presentation',
     'application/rtf',

     -- Plain text / data
     'text/plain',
     'text/csv',
     'text/markdown',
     'text/tab-separated-values',
     'application/json',

     -- Archives
     'application/zip',
     'application/x-zip-compressed',
     'application/x-7z-compressed',
     'application/x-rar-compressed',
     'application/x-tar',
     'application/gzip',

     -- Audio (voice notes, future)
     'audio/mpeg',
     'audio/mp3',
     'audio/wav',
     'audio/x-wav',
     'audio/webm',
     'audio/ogg',
     'audio/mp4',
     'audio/aac',
     'audio/flac',

     -- Video (limited)
     'video/mp4',
     'video/webm',
     'video/quicktime',
     'video/x-msvideo',
     'video/x-matroska',

     -- Generic binary fallback (FileAttachments uses this when the
     -- browser doesn't recognize the file's MIME type — common for
     -- files with unusual extensions). See note above.
     'application/octet-stream'

     -- EXCLUDED (script-capable / XSS risk):
     --   image/svg+xml, image/svg
     --   text/html, application/xhtml+xml
     --   application/xml, text/xml
     --   text/javascript, application/javascript, application/ecmascript
   ]
 where id = 'hub-files';
