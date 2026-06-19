import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { URL_RE_SOURCE, URL_RE_FLAGS, normalizeUrlMatch } from '../lib/linkify'

// Mirror useConversation's author FK hint exactly so PostgREST resolves the
// join unambiguously.
const MEDIA_SELECT =
  'id, author_id, created_at, content, inline_images, attachments, author:profiles!dm_messages_author_id_fkey(id, full_name, avatar_url)'

const MEDIA_LIMIT = 500

// Descriptor field names vary by call site: inline images uploaded via
// ChatComposer use { storage_path, name, size, type, bucket }; generic
// attachments use buildAttachmentDescriptor's { storage_path, file_name,
// mime_type, size }. Normalize both shapes here.
function normalizeFileEntry(entry, msg, { isImage }) {
  if (!entry) return null
  const storage_path = entry.storage_path || entry.path || ''
  if (!storage_path) return null
  const name = entry.file_name || entry.name || 'file'
  const type = entry.mime_type || entry.type || ''
  const bucket = entry.bucket || 'dm-attachments'
  const inferredImage = isImage || (typeof type === 'string' && type.startsWith('image/'))
  return {
    storage_path,
    name,
    size: entry.size != null ? entry.size : null,
    type,
    bucket,
    isImage: inferredImage,
    authorId: msg.author_id,
    authorName: msg.author?.full_name || 'Someone',
    createdAt: msg.created_at,
    messageId: msg.id,
  }
}

/**
 * Pure derivation from a list of dm_messages rows (newest-first input order is
 * preserved) → { files, links }.
 *
 * files: every inline_images[] entry (always treated as an image) plus every
 *   attachments[] entry (image iff its MIME starts with image/), flattened and
 *   normalized. Resilient to null/non-array fields.
 * links: every http(s)/www/bare URL found in each message's `content`, deduped
 *   by url+messageId so a message echoing the same URL twice yields one row.
 */
export function deriveMedia(messages) {
  const files = []
  const links = []
  const seenLinks = new Set()
  const urlRe = new RegExp(URL_RE_SOURCE, URL_RE_FLAGS)

  for (const msg of messages || []) {
    if (!msg) continue

    const inline = Array.isArray(msg.inline_images) ? msg.inline_images : []
    for (const img of inline) {
      const f = normalizeFileEntry(img, msg, { isImage: true })
      if (f) files.push(f)
    }

    const atts = Array.isArray(msg.attachments) ? msg.attachments : []
    for (const a of atts) {
      const f = normalizeFileEntry(a, msg, { isImage: false })
      if (f) files.push(f)
    }

    const content = typeof msg.content === 'string' ? msg.content : ''
    if (content) {
      urlRe.lastIndex = 0
      let m
      while ((m = urlRe.exec(content)) !== null) {
        const raw = m[1] || m[0]
        if (!raw) continue
        const { href } = normalizeUrlMatch(raw)
        const key = `${href}::${msg.id}`
        if (seenLinks.has(key)) continue
        seenLinks.add(key)
        links.push({
          url: href,
          authorId: msg.author_id,
          authorName: msg.author?.full_name || 'Someone',
          createdAt: msg.created_at,
          messageId: msg.id,
        })
      }
    }
  }

  return { files, links }
}

/**
 * Read-only collector of files + links shared in a conversation. Queries
 * dm_messages once per conversationId (and refetches on change). No realtime
 * subscription — opening a media tab gets a fresh snapshot, which is enough for
 * this surface.
 */
export function useConversationMedia(conversationId) {
  const [files, setFiles] = useState([])
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!conversationId) { setFiles([]); setLinks([]); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const { data, error } = await supabase
        .from('dm_messages')
        .select(MEDIA_SELECT)
        .eq('conversation_id', conversationId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(MEDIA_LIMIT)
      if (cancelled) return
      if (error) {
        setFiles([])
        setLinks([])
        setLoading(false)
        return
      }
      const { files: f, links: l } = deriveMedia(data || [])
      setFiles(f)
      setLinks(l)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [conversationId])

  return { files, links, loading }
}
