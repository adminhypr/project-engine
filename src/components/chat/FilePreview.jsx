import { useState, useEffect, lazy, Suspense } from 'react'
import { FileText, FileSpreadsheet, FileArchive, File as FileIcon, Download } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatFileSize } from '../../lib/chatAttachments'
import { fileKind } from '../../lib/fileKind'
import AudioPlayer from './AudioPlayer'

// pdf.js is heavy — lazy-load the whole PdfPreview component (which itself
// dynamic-imports pdfjs-dist) so it only enters the bundle graph when a PDF
// is actually rendered.
const PdfPreview = lazy(() => import('./PdfPreview'))

// Normalize the two historical attachment descriptor shapes.
const attPath = a => a?.storage_path || a?.path || ''
const attName = a => a?.file_name || a?.name || 'file'
const attMime = a => a?.mime_type || a?.type || ''

const DOC_ICONS = {
  doc: { Icon: FileText, cls: 'bg-blue-100 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  sheet: { Icon: FileSpreadsheet, cls: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' },
  archive: { Icon: FileArchive, cls: 'bg-amber-100 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  file: { Icon: FileIcon, cls: 'bg-slate-200 dark:bg-white/10 text-slate-500 dark:text-slate-300' },
}

// Clean type-icon card for documents/sheets/archives/unknown files. Uses the
// forced-DOWNLOAD signed url (Content-Disposition: attachment) for safety.
function DocCard({ name, size, kind, downloadUrl }) {
  const { Icon, cls } = DOC_ICONS[kind] || DOC_ICONS.file
  return (
    <a
      href={downloadUrl || '#'}
      target="_blank"
      rel="noreferrer"
      download={name}
      className="mt-2 group flex items-center gap-3 w-full max-w-[320px] rounded-xl border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-dark-bg/50 hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors p-3"
      title={`Download ${name}`}
    >
      <span className={`w-10 h-10 shrink-0 grid place-items-center rounded-lg ${cls}`}>
        <Icon className="w-5 h-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{name}</span>
        {size != null && (
          <span className="block text-xs text-slate-400">{formatFileSize(size)}</span>
        )}
      </span>
      <Download className="w-4 h-4 text-slate-400 group-hover:text-brand-500 shrink-0" />
    </a>
  )
}

// Inline image card (rare: an image arrived via `attachments` rather than
// inline_images). Renders a thumbnail that opens the shared lightbox.
function ImageCard({ name, inlineUrl, onZoom }) {
  if (!inlineUrl) {
    return <div className="mt-2 w-32 h-24 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-100 dark:bg-dark-bg animate-pulse" />
  }
  return (
    <img
      src={inlineUrl}
      alt={name}
      loading="lazy"
      onClick={() => onZoom?.({ src: inlineUrl, alt: name })}
      className="mt-2 max-w-full max-h-48 h-auto rounded-lg border border-slate-200 dark:border-dark-border cursor-pointer hover:opacity-90 transition-opacity"
      style={{ maxWidth: 'min(320px, 100%)' }}
    />
  )
}

/**
 * Renders ONE attachment with a Slack-style rich preview, branching on
 * fileKind. Signs its own URLs against `bucket`:
 *   - audio/pdf/image need an INLINE signed url (no Content-Disposition) so the
 *     browser plays/renders rather than downloads.
 *   - doc/sheet/archive/file use a forced-DOWNLOAD signed url (XSS-safe).
 *
 * `onZoom({src, alt})` wires image-in-attachments into the parent lightbox.
 */
export default function FilePreview({ attachment, bucket = 'dm-attachments', onZoom }) {
  const path = attPath(attachment)
  const name = attName(attachment)
  const size = attachment?.size
  const kind = fileKind(attMime(attachment), name)

  const needsInline = kind === 'audio' || kind === 'pdf' || kind === 'image'
  const [inlineUrl, setInlineUrl] = useState(null)
  const [downloadUrl, setDownloadUrl] = useState(null)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    async function sign() {
      if (needsInline) {
        const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600)
        if (!cancelled && data?.signedUrl) setInlineUrl(data.signedUrl)
      } else {
        const { data } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, 3600, { download: name || true })
        if (!cancelled && data?.signedUrl) setDownloadUrl(data.signedUrl)
      }
    }
    sign()
    return () => { cancelled = true }
  }, [path, bucket, needsInline, name])

  if (kind === 'audio') {
    return inlineUrl
      ? <AudioPlayer src={inlineUrl} name={name} size={size} />
      : <div className="mt-2 w-full max-w-[420px] h-[68px] rounded-xl border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-dark-bg/50 animate-pulse" />
  }

  if (kind === 'pdf') {
    return inlineUrl ? (
      <Suspense fallback={<div className="mt-2 w-[240px] h-[120px] rounded-xl border border-slate-200 dark:border-dark-border bg-slate-100 dark:bg-dark-bg animate-pulse" />}>
        <PdfPreview src={inlineUrl} name={name} size={size} />
      </Suspense>
    ) : (
      <div className="mt-2 w-[240px] h-[120px] rounded-xl border border-slate-200 dark:border-dark-border bg-slate-100 dark:bg-dark-bg animate-pulse" />
    )
  }

  if (kind === 'image') {
    return <ImageCard name={name} inlineUrl={inlineUrl} onZoom={onZoom} />
  }

  // doc / sheet / archive / file
  return <DocCard name={name} size={size} kind={kind} downloadUrl={downloadUrl} />
}

// Renders a list of attachments, each as its own rich preview.
export function FilePreviewList({ attachments, bucket, onZoom }) {
  if (!attachments || attachments.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      {attachments.map((a, i) => (
        <FilePreview key={attPath(a) + i} attachment={a} bucket={bucket} onZoom={onZoom} />
      ))}
    </div>
  )
}
