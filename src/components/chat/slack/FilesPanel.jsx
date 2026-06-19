import { useState, useEffect, useCallback } from 'react'
import { FileText, Download, Loader2, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { formatFileSize } from '../../../lib/chatAttachments'
import { formatDateShort } from '../../../lib/helpers'

// Lazily mint signed URLs for the files we have, keyed by storage_path. Images
// get a plain signed URL (raster, safe to render inline / lightbox); non-image
// files get Content-Disposition: attachment so a hostile .html/.svg downloads
// instead of executing — mirrors RichContentRenderer's split.
function useSignedFileUrls(files) {
  const [urls, setUrls] = useState({})
  useEffect(() => {
    if (!files || files.length === 0) { setUrls({}); return }
    let cancelled = false
    ;(async () => {
      const next = {}
      for (const f of files) {
        if (!f.storage_path || next[f.storage_path]) continue
        const opts = f.isImage ? undefined : { download: f.name || true }
        const { data } = await supabase.storage
          .from(f.bucket || 'dm-attachments')
          .createSignedUrl(f.storage_path, 3600, opts)
        if (data?.signedUrl) next[f.storage_path] = data.signedUrl
      }
      if (!cancelled) setUrls(next)
    })()
    return () => { cancelled = true }
  }, [files])
  return urls
}

function Lightbox({ src, alt, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors">
        <X size={20} />
      </button>
      <img src={src} alt={alt} className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" onClick={e => e.stopPropagation()} />
    </div>
  )
}

export default function FilesPanel({ files = [], loading = false }) {
  const urls = useSignedFileUrls(files)
  const [lightbox, setLightbox] = useState(null)
  const closeLightbox = useCallback(() => setLightbox(null), [])

  const images = files.filter(f => f.isImage)
  const others = files.filter(f => !f.isImage)

  if (loading) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        No files shared yet.
      </div>
    )
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6">
      {images.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
            Images
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {images.map((f, i) => {
              const url = urls[f.storage_path]
              return (
                <button
                  key={`${f.storage_path}-${i}`}
                  type="button"
                  onClick={() => url && setLightbox({ src: url, alt: f.name })}
                  className="group relative aspect-square rounded-lg overflow-hidden border border-slate-200 dark:border-dark-border bg-slate-100 dark:bg-dark-bg"
                  title={`${f.name} · shared by ${f.authorName} · ${formatDateShort(f.createdAt)}`}
                >
                  {url ? (
                    <img
                      src={url}
                      alt={f.name}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:opacity-90 transition-opacity"
                      onError={e => { e.target.style.display = 'none' }}
                    />
                  ) : (
                    <span className="absolute inset-0 animate-pulse" />
                  )}
                </button>
              )
            })}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
            Files
          </h3>
          <ul className="space-y-1.5">
            {others.map((f, i) => {
              const url = urls[f.storage_path]
              return (
                <li key={`${f.storage_path}-${i}`}>
                  <a
                    href={url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={f.name}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-200 dark:border-dark-border hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <span className="shrink-0 grid place-items-center w-9 h-9 rounded-md bg-slate-100 dark:bg-dark-bg text-slate-500 dark:text-slate-400">
                      <FileText className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{f.name}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">
                        {f.size != null && <>{formatFileSize(f.size)} · </>}
                        shared by {f.authorName} · {formatDateShort(f.createdAt)}
                      </span>
                    </span>
                    <Download className="w-4 h-4 shrink-0 text-slate-400" />
                  </a>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {lightbox && <Lightbox src={lightbox.src} alt={lightbox.alt} onClose={closeLightbox} />}
    </div>
  )
}
