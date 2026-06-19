import { useRef, useState, useEffect, useCallback } from 'react'
import { FileText, X } from 'lucide-react'
import { formatFileSize } from '../../lib/chatAttachments'

// Inline PDF preview: renders page 1 to a <canvas> thumbnail via pdf.js, and
// opens the full document in a modal (iframe) on click.
//
// pdf.js is LAZY-LOADED (dynamic import inside an effect) so it lands in its
// own chunk and never bloats the main bundle — the import only fires when a
// PDF attachment actually mounts. The worker is wired with Vite's `?url`
// pattern so the bundler emits it as a separate asset.

let pdfjsPromise = null
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist')
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
      return pdfjs
    })()
  }
  return pdfjsPromise
}

const THUMB_W = 220

function PdfModal({ src, name, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        <X size={20} />
      </button>
      <div
        className="w-full max-w-4xl h-[90vh] bg-white dark:bg-dark-card rounded-lg overflow-hidden shadow-panel"
        onClick={e => e.stopPropagation()}
      >
        <iframe src={src} title={name || 'PDF'} className="w-full h-full border-0" />
      </div>
    </div>
  )
}

export default function PdfPreview({ src, name, size }) {
  const canvasRef = useRef(null)
  const renderedRef = useRef(false) // guard against re-render churn
  const [status, setStatus] = useState('loading') // loading | done | error
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!src || renderedRef.current) return
    let cancelled = false
    let renderTask = null

    ;(async () => {
      try {
        const pdfjs = await loadPdfjs()
        if (cancelled) return
        const loadingTask = pdfjs.getDocument(src)
        const pdf = await loadingTask.promise
        if (cancelled) return
        const page = await pdf.getPage(1)
        if (cancelled) return
        const baseViewport = page.getViewport({ scale: 1 })
        const scale = THUMB_W / baseViewport.width
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        canvas.width = viewport.width
        canvas.height = viewport.height
        renderTask = page.render({ canvasContext: ctx, viewport })
        await renderTask.promise
        if (cancelled) return
        renderedRef.current = true
        setStatus('done')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      try { renderTask?.cancel() } catch { /* noop */ }
    }
  }, [src])

  const handleOpen = useCallback(() => setOpen(true), [])
  const handleClose = useCallback(() => setOpen(false), [])

  // On render failure, fall back to a clean type card (same shape as DocCard).
  if (status === 'error') {
    return (
      <>
        <button
          type="button"
          onClick={handleOpen}
          disabled={!src}
          className="mt-2 flex items-center gap-3 w-full max-w-[320px] text-left rounded-xl border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-dark-bg/50 hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors p-3"
        >
          <span className="w-10 h-10 shrink-0 grid place-items-center rounded-lg bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400">
            <FileText className="w-5 h-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">
              {name || 'Document.pdf'}
            </span>
            {size != null && (
              <span className="block text-xs text-slate-400">{formatFileSize(size)}</span>
            )}
          </span>
        </button>
        {open && <PdfModal src={src} name={name} onClose={handleClose} />}
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={!src}
        className="mt-2 block w-fit max-w-[260px] text-left rounded-xl border border-slate-200 dark:border-dark-border bg-slate-50 dark:bg-dark-bg/50 hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors overflow-hidden"
        title={`Open ${name || 'PDF'}`}
      >
        <div className="relative bg-white dark:bg-slate-900 flex items-center justify-center" style={{ minHeight: 120 }}>
          {status === 'loading' && (
            <div
              className="w-[220px] h-[160px] bg-slate-100 dark:bg-dark-bg animate-pulse"
              aria-label="Rendering PDF preview"
            />
          )}
          <canvas
            ref={canvasRef}
            className={status === 'done' ? 'block max-w-full h-auto' : 'hidden'}
          />
        </div>
        <div className="flex items-center gap-2 p-2.5 min-w-0">
          <FileText className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">
            {name || 'Document.pdf'}
          </span>
          {size != null && (
            <span className="text-xs text-slate-400 shrink-0">{formatFileSize(size)}</span>
          )}
        </div>
      </button>
      {open && <PdfModal src={src} name={name} onClose={handleClose} />}
    </>
  )
}
