import { useState, useEffect, useMemo, useCallback } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { buildMentionSegments } from '../../lib/mentions'

function ImageModal({ src, alt, onClose }) {
  useEffect(() => {
    function handleKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70" onClick={onClose}>
      <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors">
        <X size={20} />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
        onClick={e => e.stopPropagation()}
      />
    </div>
  )
}

export default function RichContentRenderer({ content, mentions = [], inlineImages = [], attachments = [], attachmentBucket = 'hub-files' }) {
  const [signedUrls, setSignedUrls] = useState({})
  const [attSignedUrls, setAttSignedUrls] = useState({})
  const [modalImage, setModalImage] = useState(null)

  const handleCloseModal = useCallback(() => setModalImage(null), [])

  useEffect(() => {
    if (inlineImages.length === 0) return
    let cancelled = false

    async function signAll() {
      const urls = {}
      for (const img of inlineImages) {
        const { data } = await supabase.storage
          .from('hub-files')
          .createSignedUrl(img.storage_path, 3600)
        if (data?.signedUrl) urls[img.storage_path] = data.signedUrl
      }
      if (!cancelled) setSignedUrls(urls)
    }

    signAll()
    return () => { cancelled = true }
  }, [inlineImages])

  useEffect(() => {
    if (attachments.length === 0) return
    let cancelled = false
    async function signAll() {
      const urls = {}
      for (const a of attachments) {
        const { data } = await supabase.storage.from(attachmentBucket).createSignedUrl(a.path, 3600)
        if (data?.signedUrl) urls[a.path] = data.signedUrl
      }
      if (!cancelled) setAttSignedUrls(urls)
    }
    signAll()
    return () => { cancelled = true }
  }, [attachments, attachmentBucket])

  const segments = useMemo(
    () => buildMentionSegments(content || '', mentions),
    [content, mentions]
  )

  return (
    <div>
      <p className="whitespace-pre-wrap break-words">
        {segments.map((seg, i) =>
          seg.type === 'mention' ? (
            <span
              key={i}
              className="inline-block bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 font-medium rounded px-1 -mx-0.5"
            >
              {seg.value}
            </span>
          ) : (
            <span key={i}>{seg.value}</span>
          )
        )}
      </p>

      {inlineImages.length > 0 ? (
        <div className="flex flex-wrap gap-2 mt-2">
          {inlineImages.map((img, i) => {
            const url = signedUrls[img.storage_path]
            return url ? (
              <img
                key={img.file_id || i}
                src={url}
                alt={img.file_name}
                loading="lazy"
                className="max-w-xs max-h-48 rounded-lg border border-slate-200 dark:border-dark-border cursor-pointer hover:opacity-90 transition-opacity"
                onClick={() => setModalImage({ src: url, alt: img.file_name })}
                onError={e => { e.target.style.display = 'none' }}
              />
            ) : (
              <div
                key={img.file_id || i}
                className="w-32 h-24 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-100 dark:bg-dark-bg animate-pulse"
              />
            )
          })}
        </div>
      ) : null}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {attachments.map((a, i) => {
            const url = attSignedUrls[a.path]
            return (
              <a
                key={a.path + i}
                href={url || '#'}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-dark-bg/50 border border-slate-200 dark:border-dark-border hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors"
              >
                <span className="text-slate-500 dark:text-slate-400">📎</span>
                <span className="text-slate-700 dark:text-slate-300 truncate max-w-[160px]">{a.name}</span>
              </a>
            )
          })}
        </div>
      )}

      {modalImage !== null && (
        <ImageModal src={modalImage.src} alt={modalImage.alt} onClose={handleCloseModal} />
      )}
    </div>
  )
}
