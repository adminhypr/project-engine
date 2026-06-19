import { useState, useEffect, useMemo, useCallback } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { buildMentionSegments } from '../../lib/mentions'
import { replaceEmoticons } from '../../lib/emoticons'
import parse from 'html-react-parser'
import DOMPurify from 'dompurify'
import { isHtmlContent } from '../../lib/contentFormat'
import { INLINE_MD_RE_SOURCE, INLINE_MD_FLAGS, normalizeUrlMatch, parseBlocks } from '../../lib/linkify'
import { formatFileSize } from '../../lib/chatAttachments'

// Attachment descriptors come in two historical shapes: card/chat use
// `{ storage_path, file_name, size }`; older callers used `{ path, name }`.
// Normalize so the renderer handles both.
const attPath = a => a?.storage_path || a?.path || ''
const attName = a => a?.file_name || a?.name || 'file'

function renderInlineMarkdown(text, keyBase) {
  const nodes = []
  let lastIndex = 0
  let match
  let k = 0
  const re = new RegExp(INLINE_MD_RE_SOURCE, INLINE_MD_FLAGS)
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    if (match[1] !== undefined) {
      nodes.push(<strong key={`${keyBase}-${k++}`}>{match[1]}</strong>)
    } else if (match[2] !== undefined) {
      nodes.push(<em key={`${keyBase}-${k++}`}>{match[2]}</em>)
    } else if (match[3] !== undefined) {
      // [text](url) markdown link
      nodes.push(
        <a
          key={`${keyBase}-${k++}`}
          href={match[4]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-600 dark:text-brand-400 hover:underline break-all"
        >
          {match[3]}
        </a>
      )
    } else if (match[5] !== undefined) {
      // Bare URL (protocol, www., or allowlisted-TLD bare domain).
      // Strip trailing punctuation; prepend https:// if no protocol present.
      const { displayUrl, href, trailing } = normalizeUrlMatch(match[5])
      nodes.push(
        <a
          key={`${keyBase}-${k++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-600 dark:text-brand-400 hover:underline break-all"
        >
          {displayUrl}
        </a>
      )
      if (trailing) nodes.push(trailing)
    } else if (match[6] !== undefined) {
      // ~~strikethrough~~
      nodes.push(<s key={`${keyBase}-${k++}`}>{match[6]}</s>)
    } else if (match[7] !== undefined) {
      // `inline code` — content is literal (no nested markdown).
      nodes.push(
        <code
          key={`${keyBase}-${k++}`}
          className="px-1 py-0.5 rounded bg-slate-100 dark:bg-dark-bg/60 text-[0.85em] font-mono"
        >
          {match[7]}
        </code>
      )
    }
    lastIndex = re.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

// Render a single line of plaintext: split out @mentions first, then run
// emoticon replacement + inline markdown on the non-mention spans. Mentions
// render as highlighted chips and are never reinterpreted as markdown.
function renderTextLine(line, mentions, keyBase) {
  const segs = buildMentionSegments(line, mentions)
  return segs.map((seg, i) =>
    seg.type === 'mention' ? (
      <span
        key={`${keyBase}-m${i}`}
        className="inline-block bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 font-medium rounded px-1 -mx-0.5"
      >
        {seg.value}
      </span>
    ) : (
      <span key={`${keyBase}-t${i}`}>
        {renderInlineMarkdown(replaceEmoticons(seg.value), `${keyBase}-t${i}`)}
      </span>
    )
  )
}

// Render parsed blocks (paragraphs, fenced code, blockquotes, lists) for the
// plaintext path. Code blocks are verbatim; every other block runs each line
// through renderTextLine so inline markdown + mentions still apply.
function renderBlocks(content, mentions) {
  const blocks = parseBlocks(content)
  return blocks.map((block, bi) => {
    if (block.type === 'code') {
      return (
        <pre
          key={`b${bi}`}
          className="my-1 p-2 rounded-lg bg-slate-100 dark:bg-dark-bg/60 overflow-x-auto text-[0.85em]"
        >
          <code className="font-mono whitespace-pre-wrap break-words">{block.code}</code>
        </pre>
      )
    }
    if (block.type === 'quote') {
      return (
        <blockquote
          key={`b${bi}`}
          className="my-1 pl-3 border-l-2 border-slate-300 dark:border-dark-border text-slate-600 dark:text-slate-400"
        >
          {block.lines.map((ln, li) => (
            <div key={li} className="whitespace-pre-wrap break-words">
              {renderTextLine(ln, mentions, `b${bi}-${li}`)}
            </div>
          ))}
        </blockquote>
      )
    }
    if (block.type === 'ul' || block.type === 'ol') {
      const ListTag = block.type === 'ul' ? 'ul' : 'ol'
      return (
        <ListTag
          key={`b${bi}`}
          className={`my-1 pl-5 ${block.type === 'ul' ? 'list-disc' : 'list-decimal'}`}
        >
          {block.items.map((item, li) => (
            <li key={li} className="whitespace-pre-wrap break-words">
              {renderTextLine(item, mentions, `b${bi}-${li}`)}
            </li>
          ))}
        </ListTag>
      )
    }
    // Paragraph block: join lines with <br/>, preserving wrapping.
    return (
      <p key={`b${bi}`} className="whitespace-pre-wrap break-words">
        {block.lines.map((ln, li) => (
          <span key={li}>
            {li > 0 && <br />}
            {renderTextLine(ln, mentions, `b${bi}-${li}`)}
          </span>
        ))}
      </p>
    )
  })
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

// Forced-download chips for non-image attachments. The signed URLs are
// already minted with Content-Disposition: attachment by the caller, so
// these are plain anchors. `download` attribute is a belt-and-suspenders
// hint for same-origin cases.
function AttachmentChips({ attachments, signedUrls }) {
  if (!attachments || attachments.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {attachments.map((a, i) => {
        const path = attPath(a)
        const name = attName(a)
        const url = signedUrls[path]
        return (
          <a
            key={path + i}
            href={url || '#'}
            target="_blank"
            rel="noreferrer"
            download={name}
            className="flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-dark-bg/50 border border-slate-200 dark:border-dark-border hover:bg-slate-100 dark:hover:bg-dark-hover transition-colors"
            title={`Download ${name}`}
          >
            <span className="text-slate-500 dark:text-slate-400">📎</span>
            <span className="text-slate-700 dark:text-slate-300 truncate max-w-[160px]">{name}</span>
            {a.size != null && (
              <span className="text-slate-400 shrink-0">({formatFileSize(a.size)})</span>
            )}
          </a>
        )
      })}
    </div>
  )
}

const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['p','strong','em','u','s','a','ul','ol','li','blockquote','h1','h2','h3','h4','h5','h6','br','span','img'],
  ALLOWED_ATTR: ['href','target','rel','class','data-type','data-id','data-label','src','alt','data-file-id','data-file-name','data-mime','data-storage-path'],
}

export default function RichContentRenderer({ content, mentions = [], inlineImages = [], attachments = [], attachmentBucket = 'hub-files', imagesBucket = 'hub-files' }) {
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
        // External entries (e.g. hotlinked GIPHY GIFs) carry a ready-to-use
        // `url` and no storage_path — they live on a third-party CDN, not our
        // bucket, so there's nothing to sign. Skip them.
        if (img.url || !img.storage_path) continue
        // Sign each image against the bucket where it ACTUALLY lives, not a
        // per-surface default. A campfire image can be authored from the hub
        // module (RichInput → hub-files, carries a file_id) OR the /chat page
        // / widget (ChatComposer → dm-attachments). Without this, the same
        // image signed against the wrong bucket fails to load — visible to the
        // sender on their surface but not to members on the other surface.
        const bucket = img.bucket || (img.file_id ? 'hub-files' : imagesBucket)
        const { data } = await supabase.storage
          .from(bucket)
          .createSignedUrl(img.storage_path, 3600)
        if (data?.signedUrl) urls[img.storage_path] = data.signedUrl
      }
      if (!cancelled) setSignedUrls(urls)
    }

    signAll()
    return () => { cancelled = true }
  }, [inlineImages, imagesBucket])

  useEffect(() => {
    if (attachments.length === 0) return
    let cancelled = false
    async function signAll() {
      const urls = {}
      for (const a of attachments) {
        const path = attPath(a)
        if (!path) continue
        // Forced download (Content-Disposition: attachment) so a hostile
        // .html/.svg/.js attachment downloads instead of executing — the
        // chat bucket accepts any MIME type, so this render-time guard is
        // the XSS control. Inline images use a plain signed URL (raster
        // only, safe to render); see chatAttachments.isInlineImage.
        const { data } = await supabase.storage
          .from(attachmentBucket)
          .createSignedUrl(path, 3600, { download: attName(a) || true })
        if (data?.signedUrl) urls[path] = data.signedUrl
      }
      if (!cancelled) setAttSignedUrls(urls)
    }
    signAll()
    return () => { cancelled = true }
  }, [attachments, attachmentBucket])

  const blockNodes = useMemo(
    () => renderBlocks(content || '', mentions),
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
              onClick={() => setModalImage({ src: url, alt: name })}
              className="max-w-full max-h-48 h-auto rounded-lg border border-slate-200 dark:border-dark-border cursor-pointer hover:opacity-90 transition-opacity"
              style={{ maxWidth: 'min(320px, 100%)' }}
            />
          ) : (
            <span className="inline-block max-w-full w-32 h-24 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-100 dark:bg-dark-bg animate-pulse" />
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
        <AttachmentChips attachments={attachments} signedUrls={attSignedUrls} />
        {modalImage !== null && (
          <ImageModal src={modalImage.src} alt={modalImage.alt} onClose={handleCloseModal} />
        )}
      </div>
    )
  }

  return (
    <div>
      {blockNodes}

      {inlineImages.length > 0 ? (
        <div className="flex flex-wrap gap-2 mt-2">
          {inlineImages.map((img, i) => {
            // External (hotlinked) images — e.g. GIPHY GIFs — carry a ready
            // `url`; storage-backed images resolve through signedUrls.
            const url = img.url || signedUrls[img.storage_path]
            const isGiphy = img.source === 'giphy'
            // GIFs show the lighter fixed-width preview in-stream but zoom to
            // the full GIF on click; storage images use the same url for both.
            const displaySrc = isGiphy ? (img.preview_url || img.url) : url
            const zoomSrc = isGiphy ? img.url : url
            const alt = isGiphy ? (img.name || 'GIF') : img.file_name
            return url ? (
              <img
                key={img.giphy_id || img.file_id || i}
                src={displaySrc}
                alt={alt}
                loading="lazy"
                className="max-w-full max-h-48 h-auto rounded-lg border border-slate-200 dark:border-dark-border cursor-pointer hover:opacity-90 transition-opacity"
                style={{ maxWidth: 'min(320px, 100%)' }}
                onClick={() => setModalImage({ src: zoomSrc, alt })}
                onError={e => {
                  // We hotlink GIPHY: a deleted/unavailable GIF won't load.
                  // Swap in a small inline placeholder rather than vanishing.
                  if (isGiphy) {
                    const span = document.createElement('span')
                    span.className = 'inline-block px-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-dark-border text-slate-400'
                    span.textContent = '[GIF unavailable]'
                    e.target.replaceWith(span)
                  } else {
                    e.target.style.display = 'none'
                  }
                }}
              />
            ) : (
              <div
                key={img.file_id || i}
                className="max-w-full w-32 h-24 rounded-lg border border-slate-200 dark:border-dark-border bg-slate-100 dark:bg-dark-bg animate-pulse"
              />
            )
          })}
        </div>
      ) : null}

      <AttachmentChips attachments={attachments} signedUrls={attSignedUrls} />

      {modalImage !== null && (
        <ImageModal src={modalImage.src} alt={modalImage.alt} onClose={handleCloseModal} />
      )}
    </div>
  )
}
