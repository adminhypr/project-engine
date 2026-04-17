import { useState, useEffect, useMemo, useCallback } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { buildMentionSegments } from '../../lib/mentions'
import parse from 'html-react-parser'
import DOMPurify from 'dompurify'
import { isHtmlContent } from '../../lib/contentFormat'

const INLINE_MD_RE = /\*\*([^*\n]+?)\*\*|_([^_\n]+?)_|\[([^\]\n]+?)\]\(([^)\n]+?)\)/g

function renderInlineMarkdown(text, keyBase) {
  const nodes = []
  let lastIndex = 0
  let match
  let k = 0
  const re = new RegExp(INLINE_MD_RE.source, 'g')
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyBase}-${k++}`}>{match[1]}</strong>)
    } else if (match[2] !== undefined) {
      nodes.push(<em key={`${keyBase}-${k++}`}>{match[2]}</em>)
    } else {
      nodes.push(
        <a
          key={`${keyBase}-${k++}`}
          href={match[4]}
          target="_blank"
          rel="noreferrer"
          className="text-brand-600 dark:text-brand-400 hover:underline"
        >
          {match[3]}
        </a>
      )
    }
    lastIndex = re.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

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

const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['p','strong','em','u','s','a','ul','ol','li','blockquote','h1','h2','h3','h4','h5','h6','br','span','img'],
  ALLOWED_ATTR: ['href','target','rel','class','data-type','data-id','data-label','src','alt','data-file-id','data-file-name','data-mime','data-storage-path'],
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

  const isHtml = isHtmlContent(content)

  // Shared: sign URLs for <img data-file-id="..."> on the HTML path.
  const htmlFileIds = useMemo(() => {
    if (!isHtml) return []
    const out = []
    const doc = new DOMParser().parseFromString(content || '', 'text/html')
    doc.querySelectorAll('img[data-file-id]').forEach(img => {
      const id = img.getAttribute('data-file-id')
      const path = img.getAttribute('data-storage-path')
      if (id && path) out.push({ file_id: id, storage_path: path })
    })
    return out
  }, [content, isHtml])

  const [htmlSignedUrls, setHtmlSignedUrls] = useState({})
  useEffect(() => {
    if (!isHtml || htmlFileIds.length === 0) return
    let cancelled = false
    async function signAll() {
      const urls = {}
      for (const img of htmlFileIds) {
        const { data } = await supabase.storage.from('hub-files').createSignedUrl(img.storage_path, 3600)
        if (data?.signedUrl) urls[img.file_id] = data.signedUrl
      }
      if (!cancelled) setHtmlSignedUrls(urls)
    }
    signAll()
    return () => { cancelled = true }
  }, [htmlFileIds, isHtml])

  if (isHtml) {
    const clean = DOMPurify.sanitize(content || '', PURIFY_CONFIG)
    const tree = parse(clean, {
      replace(node) {
        if (node.type !== 'tag') return
        if (node.name === 'span' && node.attribs?.['data-type'] === 'mention') {
          const label = node.attribs['data-label'] || node.children?.[0]?.data || ''
          return (
            <span className="inline-block bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 font-medium rounded px-1 -mx-0.5">
              {label.startsWith('@') ? label : `@${label}`}
            </span>
          )
        }
        if (node.name === 'img' && node.attribs?.['data-file-id']) {
          const id = node.attribs['data-file-id']
          const name = node.attribs['data-file-name'] || ''
          const url = htmlSignedUrls[id] || node.attribs.src || ''
          return url ? (
            <img
              src={url}
              alt={name}
              loading="lazy"
              className="max-w-xs max-h-48 rounded-lg border border-slate-200 dark:border-dark-border"
            />
          ) : (
            <span className="inline-block w-32 h-24 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-100 dark:bg-dark-bg animate-pulse" />
          )
        }
        if (node.name === 'a') {
          node.attribs.target = '_blank'
          node.attribs.rel = 'noopener noreferrer nofollow'
          node.attribs.class = 'text-brand-600 dark:text-brand-400 hover:underline'
        }
      },
    })
    return (
      <div className="rich-html prose prose-sm dark:prose-invert max-w-none">
        {tree}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {attachments.map((a, i) => {
              const url = attSignedUrls[a.path]
              return (
                <a key={a.path + i} href={url || '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-dark-bg/50 border border-slate-200 dark:border-dark-border hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors">
                  <span className="text-slate-500 dark:text-slate-400">📎</span>
                  <span className="text-slate-700 dark:text-slate-300 truncate max-w-[160px]">{a.name}</span>
                </a>
              )
            })}
          </div>
        )}
      </div>
    )
  }

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
            <span key={i}>{renderInlineMarkdown(seg.value, `s${i}`)}</span>
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
