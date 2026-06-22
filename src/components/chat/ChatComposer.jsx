import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Send, X, CornerUpLeft, Loader2, Paperclip, FileText,
  Bold, Italic, Strikethrough, Link as LinkIcon, ListOrdered, List,
  Quote, Code, SquareCode, Type, Film, Smile, AtSign,
} from 'lucide-react'
import GifPicker from './GifPicker'
import EmojiPicker from './EmojiPicker'
import { giphyEnabled } from '../../lib/giphy'
import { supabase } from '../../lib/supabase'
import { showToast } from '../ui'
import ImageAttachments from './ImageAttachments'
import { useReplyContext } from './ReplyContext'
import { wrapSelection, prefixLines } from '../../lib/composerFormat'
import {
  isInlineImage,
  attachmentStoragePath,
  buildAttachmentDescriptor,
  formatFileSize,
} from '../../lib/chatAttachments'

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 // dm-attachments cap (mig 105)
import MentionPopover from './MentionPopover'
import { parseMentionQuery, insertMention } from '../../lib/mentions'
import { useAuth } from '../../hooks/useAuth'
import { readDraft, writeDraft, clearDraft } from '../../lib/draftStorage'
import { useChatPrefs } from '../../hooks/useChatPrefs'
import { getPrefs } from '../../lib/chatPrefs'

const MAX_LEN = 4000
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

async function uploadImages(conversationId, items, onItemStart) {
  const uploaded = []
  for (const [i, it] of items.entries()) {
    onItemStart?.(i)
    const messageUuid = crypto.randomUUID()
    const ext = (it.name.split('.').pop() || 'png').toLowerCase()
    const path = `${conversationId}/${messageUuid}/${messageUuid}.${ext}`
    const { error } = await supabase.storage
      .from('dm-attachments')
      .upload(path, it.file, { contentType: it.type, upsert: false })
    if (error) { showToast('Image upload failed', 'error'); continue }
    // Stamp the bucket so the renderer signs against the right one regardless
    // of which surface (widget / chat page / hub module) displays the message.
    uploaded.push({ storage_path: path, name: it.name, size: it.size, type: it.type, bucket: 'dm-attachments' })
  }
  return uploaded
}

const MIN_H = 40
const DEFAULT_H = 40
const MAX_H = 260
const MAX_MENTION_MATCHES = 6

export default function ChatComposer({ conversationId, onSend, onTyping, disabled, mentionablePeople = [], threadRootId = null, placeholder = 'Type a message…' }) {
  const { profile } = useAuth()
  const profileId = profile?.id
  // Chat prefs: toolbarDefault seeds the initial toolbar visibility (still
  // togglable per session); sendOnEnter switches Enter↔Cmd/Ctrl+Enter send.
  const [prefs] = useChatPrefs(profileId)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [images, setImages] = useState([])
  // Generic (non-image) file attachments — uploaded immediately to
  // dm-attachments, persisted on the message.
  const [attachments, setAttachments] = useState([])
  const [attUploading, setAttUploading] = useState([]) // [{ id, name }]
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  // Index of the image currently uploading during send (null when idle) —
  // drives the per-thumbnail overlay and the "Uploading n of m" line.
  const [uploadingIndex, setUploadingIndex] = useState(null)
  const [textareaHeight, setTextareaHeight] = useState(DEFAULT_H)
  const [pickedMentions, setPickedMentions] = useState([])
  const [mentionQuery, setMentionQuery] = useState(null) // { query, startIndex } | null
  const [mentionIdx, setMentionIdx] = useState(0)
  const [showToolbar, setShowToolbar] = useState(() => getPrefs(profileId).toolbarDefault === true)
  // Only one anchored popover open at a time ('gif' | 'emoji' | null) so the
  // GIF and emoji pickers never overlap above the composer.
  const [openPopover, setOpenPopover] = useState(null)
  const gifOpen = openPopover === 'gif'
  const emojiOpen = openPopover === 'emoji'
  const { target: replyTarget, clearReply, requestReply } = useReplyContext()
  const textareaRef = useRef(null)
  // Draft restore guard — we only hydrate once per conversation so in-flight
  // edits don't get stomped by a later draft read.
  const hydratedKeyRef = useRef(null)

  // Load any saved draft when the conversation changes. Also restores the
  // previously-attached reply target if there was one.
  useEffect(() => {
    if (!profileId || !conversationId) return
    const hydrateKey = `${profileId}:${conversationId}:${threadRootId || ''}`
    if (hydratedKeyRef.current === hydrateKey) return
    hydratedKeyRef.current = hydrateKey
    const draft = readDraft(profileId, conversationId, threadRootId)
    if (draft) {
      if (draft.text) setValue(draft.text)
      if (Array.isArray(draft.mentions) && draft.mentions.length > 0) {
        setPickedMentions(draft.mentions)
      }
      // Re-arm the reply banner if the draft was mid-reply.
      if (draft.replyTo?.id && !replyTarget) {
        requestReply(
          { id: draft.replyTo.id, author_id: draft.replyTo.author_id, content: draft.replyTo.preview },
          draft.replyTo.authorName || 'them',
        )
      }
    }
    // Intentionally not depending on replyTarget/requestReply — we only want
    // to run on (profileId, conversationId, threadRootId) change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, conversationId, threadRootId])

  // Persist the current draft whenever it changes (value, mentions, reply).
  useEffect(() => {
    if (!profileId || !conversationId) return
    writeDraft(profileId, conversationId, {
      text: value,
      replyTo: replyTarget
        ? {
            id: replyTarget.id,
            author_id: replyTarget.author_id,
            authorName: replyTarget.authorName,
            preview: replyTarget.preview,
          }
        : null,
      mentions: pickedMentions,
    }, threadRootId)
  }, [profileId, conversationId, threadRootId, value, replyTarget, pickedMentions])

  // Filter + limit candidates whenever the query changes.
  const mentionCandidates = useMemo(() => {
    if (!mentionQuery || !mentionablePeople || mentionablePeople.length === 0) return []
    const q = mentionQuery.query.toLowerCase()
    return mentionablePeople
      .filter(p => (p.full_name || '').toLowerCase().includes(q))
      .slice(0, MAX_MENTION_MATCHES)
  }, [mentionQuery, mentionablePeople])

  // Keep the active index in bounds when the candidate list changes.
  useEffect(() => {
    if (mentionIdx >= mentionCandidates.length) setMentionIdx(0)
  }, [mentionCandidates.length, mentionIdx])

  function refreshMentionQuery(newValue, cursorPos) {
    if (!mentionablePeople || mentionablePeople.length === 0) {
      setMentionQuery(null)
      return
    }
    const { active, query, startIndex } = parseMentionQuery(newValue, cursorPos)
    if (active) setMentionQuery({ query, startIndex })
    else setMentionQuery(null)
  }

  function pickMention(person) {
    const el = textareaRef.current
    if (!el) return
    const cursor = el.selectionStart ?? value.length
    const { newText, newCursorPosition } = insertMention(value, cursor, person.full_name)
    setValue(newText)
    setPickedMentions(prev => {
      if (prev.some(m => m.user_id === person.id && m.display_name === person.full_name)) return prev
      return [...prev, { user_id: person.id, display_name: person.full_name }]
    })
    setMentionQuery(null)
    setMentionIdx(0)
    // Restore focus + caret after the value prop updates.
    requestAnimationFrame(() => {
      if (!textareaRef.current) return
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition)
    })
  }

  // Insert an emoji char at the current caret (replacing any selection),
  // respecting MAX_LEN, and restore the caret AFTER the inserted glyph.
  // Mirrors the rAF setSelectionRange pattern used by pickMention/applyFormat.
  function insertEmoji(char) {
    const el = textareaRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const next = (value.slice(0, start) + char + value.slice(end)).slice(0, MAX_LEN)
    setValue(next)
    const caret = Math.min(start + char.length, MAX_LEN)
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(caret, caret)
    })
  }

  // Insert a bare "@" at the caret to kick off the existing mention flow. Add a
  // leading space if the preceding char isn't whitespace/start so we don't glue
  // onto a word. After inserting, point the caret right after the "@" and prime
  // the mention query so MentionPopover opens immediately (no extra keystroke).
  function insertMentionTrigger() {
    const el = textareaRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    const prev = start > 0 ? value[start - 1] : ''
    const needsSpace = start > 0 && !/\s/.test(prev)
    const insert = (needsSpace ? ' @' : '@')
    const next = (value.slice(0, start) + insert + value.slice(end)).slice(0, MAX_LEN)
    setValue(next)
    const caret = Math.min(start + insert.length, MAX_LEN)
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(caret, caret)
      refreshMentionQuery(next, caret)
    })
  }

  // Apply a formatting transform to the current textarea selection. `fn`
  // receives (value, selStart, selEnd) and returns { text, selStart, selEnd }.
  // We write the new value back through the existing setValue and restore the
  // caret/selection after React flushes the controlled update.
  function applyFormat(fn) {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart ?? value.length
    const end = el.selectionEnd ?? value.length
    const r = fn(value, start, end)
    if (!r) return
    const next = r.text.slice(0, MAX_LEN)
    setValue(next)
    requestAnimationFrame(() => {
      const node = textareaRef.current
      if (!node) return
      node.focus()
      node.setSelectionRange(r.selStart, r.selEnd)
    })
  }

  // Inline marker wrappers (bold/italic/strike/code).
  const wrapWith = marker => () => applyFormat((v, s, e) => wrapSelection(v, s, e, marker))
  // Per-line prefixers (lists/blockquote).
  const prefixWith = prefix => () => applyFormat((v, s, e) => prefixLines(v, s, e, prefix))

  // Link: insert [selection](<placeholder>) and drop the caret inside the
  // empty parens so the user can paste/type the URL immediately.
  function applyLink() {
    applyFormat((v, s, e) => {
      const sel = v.slice(s, e)
      const inserted = `[${sel}]()`
      const out = v.slice(0, s) + inserted + v.slice(e)
      const caret = s + inserted.length - 1 // inside the ()
      return { text: out, selStart: caret, selEnd: caret }
    })
  }

  // Code block: wrap the selection in triple-backtick fences on their own
  // lines. Place the selection back over the original content between fences.
  function applyCodeBlock() {
    applyFormat((v, s, e) => {
      const sel = v.slice(s, e)
      const opening = '```\n'
      const closing = '\n```'
      const out = v.slice(0, s) + opening + sel + closing + v.slice(e)
      const selStart = s + opening.length
      return { text: out, selStart, selEnd: selStart + sel.length }
    })
  }

  function startResize(e) {
    e.preventDefault()
    const startY = e.clientY
    const startH = textareaHeight
    function onMove(ev) {
      const next = Math.min(MAX_H, Math.max(MIN_H, startH + (startY - ev.clientY)))
      setTextareaHeight(next)
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  useEffect(() => {
    if (replyTarget) textareaRef.current?.focus()
  }, [replyTarget])

  async function submit() {
    const trimmed = value.trim()
    if ((!trimmed && images.length === 0 && attachments.length === 0) || busy || disabled) return
    setBusy(true)
    const uploaded = images.length > 0
      ? await uploadImages(conversationId, images, setUploadingIndex)
      : []
    setUploadingIndex(null)
    // Only forward mentions that still appear in the outgoing text — users
    // may have deleted an inserted @name after picking it.
    const effectiveMentions = pickedMentions.filter(m =>
      trimmed.includes(`@${m.display_name}`)
    )
    const ok = await onSend(trimmed, uploaded, replyTarget, effectiveMentions, attachments)
    setBusy(false)
    if (ok) {
      setValue('')
      images.forEach(i => URL.revokeObjectURL(i.preview))
      setImages([])
      setAttachments([])
      setPickedMentions([])
      setMentionQuery(null)
      clearReply()
      // The value/mentions/replyTarget effects will write an empty draft,
      // but calling clearDraft explicitly is cheaper and avoids a race
      // where the next typed character arrives before the cleared state
      // has flushed.
      if (profileId && conversationId) clearDraft(profileId, conversationId, threadRootId)
    } else {
      // Send failed — keep the text, surface the reason so the user knows
      // nothing was lost and they can retry.
      showToast('Message not sent — saved as draft', 'error')
    }
  }

  // Slack-style: a picked GIF sends immediately as its own message. The
  // entry stores the EXTERNAL GIPHY CDN url (hotlinked, never rehosted) in
  // `url`, so RichContentRenderer skips signing it. Shape mirrors what
  // sendMessage persists into inline_images (no `preview` key to strip).
  async function handleGifSelect(gif) {
    if (busy || disabled) return
    const entry = {
      url: gif.sendUrl,
      preview_url: gif.previewUrl,
      type: 'image/gif',
      source: 'giphy',
      giphy_id: gif.id,
      name: gif.title,
      width: gif.width,
      height: gif.height,
    }
    setBusy(true)
    const ok = await onSend('', [entry], replyTarget, [], [])
    setBusy(false)
    if (ok) {
      clearReply()
    } else {
      showToast('GIF not sent — try again', 'error')
    }
  }

  function handleKey(e) {
    // Mention popover intercepts arrows + Enter/Tab.
    if (mentionQuery && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx(i => (i + 1) % mentionCandidates.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx(i => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickMention(mentionCandidates[mentionIdx])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionQuery(null)
        return
      }
    }
    if (e.key === 'Enter') {
      const withMod = e.metaKey || e.ctrlKey
      const sendOnEnter = prefs.sendOnEnter !== false
      if (sendOnEnter) {
        // Enter sends; Shift+Enter (or modifier) inserts a newline.
        if (!e.shiftKey && !withMod) {
          e.preventDefault()
          submit()
        }
      } else {
        // Cmd/Ctrl+Enter sends; plain Enter inserts a newline.
        if (withMod) {
          e.preventDefault()
          submit()
        }
      }
    } else if (e.key === 'Escape' && replyTarget) {
      e.preventDefault()
      clearReply()
    }
  }

  function handleChange(e) {
    const next = e.target.value.slice(0, MAX_LEN)
    setValue(next)
    if (next.length > 0) onTyping?.()
    refreshMentionQuery(next, e.target.selectionStart ?? next.length)
  }

  // Upload a generic (non-image) file to dm-attachments immediately so it
  // shows as a chip; persisted on the message at send.
  async function uploadAttachment(file) {
    if (file.size === 0) { showToast(`${file.name || 'File'} is empty`, 'error'); return }
    if (file.size > MAX_ATTACHMENT_BYTES) { showToast(`${file.name || 'File'} exceeds 25 MB limit`, 'error'); return }
    if (!conversationId) { showToast('Cannot attach yet — chat still loading', 'error'); return }
    const tempId = crypto.randomUUID()
    setAttUploading(prev => [...prev, { id: tempId, name: file.name || 'file' }])
    const storagePath = attachmentStoragePath(conversationId, crypto.randomUUID(), file.name)
    const { error } = await supabase.storage
      .from('dm-attachments')
      .upload(storagePath, file, { contentType: file.type || undefined })
    setAttUploading(prev => prev.filter(u => u.id !== tempId))
    if (error) { showToast('Upload failed', 'error'); return }
    setAttachments(prev => [...prev, buildAttachmentDescriptor({ storage_path: storagePath, file })])
  }

  // Single entry point for picker / paste / drop. Raster images go to the
  // inline-image tray (uploaded at send); everything else uploads now as a
  // download chip.
  function handleIncomingFile(file, pasted = false) {
    if (!file) return
    if (isInlineImage(file.type)) {
      if (file.size > MAX_IMAGE_BYTES) { showToast('Image exceeds 5 MB', 'error'); return }
      const ext = (file.type.split('/')[1] || 'png').split('+')[0]
      const name = pasted && (!file.name || file.name === 'image.png')
        ? `pasted-${Date.now()}.${ext}`
        : (file.name || `image.${ext}`)
      setImages(prev => [...prev, { file, name, type: file.type, size: file.size, preview: URL.createObjectURL(file) }])
      return
    }
    uploadAttachment(file)
  }

  function handlePickFiles(e) {
    const files = e.target.files
    if (!files) return
    for (const file of files) handleIncomingFile(file)
    e.target.value = ''
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const files = e.dataTransfer?.files
    if (!files) return
    for (const file of files) handleIncomingFile(file)
  }

  function removeAttachment(index) {
    const att = attachments[index]
    if (att?.storage_path) supabase.storage.from('dm-attachments').remove([att.storage_path]).then(() => {})
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items
    if (!items || items.length === 0) return
    const fileItems = []
    for (const item of items) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file) fileItems.push(file)
    }
    if (fileItems.length === 0) return
    e.preventDefault()
    for (const file of fileItems) handleIncomingFile(file, true)
  }

  const sendDisabled = busy || disabled || (!value.trim() && images.length === 0 && attachments.length === 0)

  return (
    <div
      className={`border-t border-slate-200 dark:border-dark-border pb-[env(safe-area-inset-bottom)] md:pb-0 ${dragOver ? 'ring-2 ring-inset ring-brand-400' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {replyTarget && (
        <div className="flex items-start gap-2 px-3 pt-2 pb-1 border-b border-slate-200/60 dark:border-dark-border/60 bg-slate-50 dark:bg-slate-800/40">
          <CornerUpLeft className="w-3.5 h-3.5 text-brand-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0 text-[11px] leading-tight">
            <div className="font-semibold text-slate-700 dark:text-slate-200">
              Replying to {replyTarget.authorName}
            </div>
            <div className="truncate text-slate-500 dark:text-slate-400">
              {replyTarget.preview}
            </div>
          </div>
          <button
            type="button"
            onClick={clearReply}
            className="text-slate-400 hover:text-slate-600 shrink-0"
            aria-label="Cancel reply"
            title="Cancel reply (Esc)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <ImageAttachments
        items={images}
        onAdd={item => setImages(s => [...s, item])}
        onRemove={idx => setImages(s => s.filter((_, i) => i !== idx))}
        uploadingIndex={uploadingIndex}
        hideButton
      />
      {uploadingIndex != null && images.length > 0 && (
        <div className="px-3 pb-1 text-[11px] text-slate-500 dark:text-slate-400" role="status">
          Uploading image {Math.min(uploadingIndex + 1, images.length)} of {images.length}…
        </div>
      )}
      {(attachments.length > 0 || attUploading.length > 0) && (
        <div className="flex flex-wrap gap-1.5 px-2 pt-2">
          {attachments.map((att, i) => (
            <div
              key={`${att.storage_path}-${i}`}
              className="group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-dark-bg/50 border border-slate-200 dark:border-dark-border text-xs"
            >
              <FileText size={12} className="shrink-0 text-slate-400" />
              <span className="text-slate-700 dark:text-slate-300 truncate max-w-[160px]" title={att.file_name}>{att.file_name}</span>
              {att.size != null && <span className="text-slate-400 shrink-0">({formatFileSize(att.size)})</span>}
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="ml-0.5 p-0.5 rounded text-slate-300 hover:text-red-500"
                aria-label={`Remove ${att.file_name}`}
              >
                <X size={11} />
              </button>
            </div>
          ))}
          {attUploading.map(u => (
            <div key={u.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-dark-bg/50 border border-slate-200 dark:border-dark-border text-xs text-slate-500">
              <Loader2 size={12} className="animate-spin text-brand-500" />
              <span className="truncate max-w-[160px]">{u.name}</span>
            </div>
          ))}
        </div>
      )}
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-0.5 px-2 pt-2" role="toolbar" aria-label="Text formatting">
          <FmtBtn icon={Bold} label="Bold" onClick={wrapWith('**')} />
          <FmtBtn icon={Italic} label="Italic" onClick={wrapWith('_')} />
          <FmtBtn icon={Strikethrough} label="Strikethrough" onClick={wrapWith('~~')} />
          <FmtDivider />
          <FmtBtn icon={LinkIcon} label="Link" onClick={applyLink} />
          <FmtDivider />
          <FmtBtn icon={ListOrdered} label="Ordered list" onClick={prefixWith(i => `${i + 1}. `)} />
          <FmtBtn icon={List} label="Bulleted list" onClick={prefixWith('- ')} />
          <FmtBtn icon={Quote} label="Blockquote" onClick={prefixWith('> ')} />
          <FmtDivider />
          <FmtBtn icon={Code} label="Code" onClick={wrapWith('`')} />
          <FmtBtn icon={SquareCode} label="Code block" onClick={applyCodeBlock} />
        </div>
      )}
      <div
        onPointerDown={startResize}
        onDoubleClick={() => setTextareaHeight(DEFAULT_H)}
        className="h-1.5 mx-2 rounded-full bg-transparent hover:bg-slate-200 dark:hover:bg-slate-700 cursor-ns-resize hidden md:flex items-center justify-center group"
        role="separator"
        aria-label="Resize composer (double-click to reset)"
        title="Drag to resize · double-click to reset"
      >
        <span className="w-8 h-0.5 rounded-full bg-slate-300 dark:bg-slate-600 group-hover:bg-slate-400 dark:group-hover:bg-slate-500" />
      </div>
      <div className="relative p-2 pt-0 flex items-end gap-2">
        {mentionQuery && mentionCandidates.length > 0 && (
          <MentionPopover
            people={mentionCandidates}
            activeIdx={mentionIdx}
            onPick={pickMention}
            onHover={setMentionIdx}
          />
        )}
        <input ref={fileInputRef} type="file" multiple hidden onChange={handlePickFiles} />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy || disabled}
          className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-slate-100 dark:hover:bg-dark-hover disabled:opacity-40"
          aria-label="Attach a file or image"
          title="Attach a file or image (drag & drop or paste too)"
        >
          <Paperclip className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setShowToolbar(v => !v)}
          aria-label="Formatting"
          aria-pressed={showToolbar}
          title="Show formatting toolbar"
          className={`w-9 h-9 shrink-0 rounded-full hidden md:flex items-center justify-center hover:bg-slate-100 dark:hover:bg-dark-hover ${showToolbar ? 'text-brand-600 dark:text-brand-400 bg-slate-100 dark:bg-dark-hover' : 'text-slate-400 hover:text-brand-600 dark:hover:text-brand-400'}`}
        >
          <Type className="w-4 h-4" />
        </button>
        <EmojiPicker
          open={emojiOpen}
          onClose={() => setOpenPopover(null)}
          onPick={insertEmoji}
        />
        <button
          type="button"
          onClick={() => setOpenPopover(p => (p === 'emoji' ? null : 'emoji'))}
          disabled={busy || disabled}
          aria-label="Insert emoji"
          aria-pressed={emojiOpen}
          title="Insert emoji"
          className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center hover:bg-slate-100 dark:hover:bg-dark-hover disabled:opacity-40 ${emojiOpen ? 'text-brand-600 dark:text-brand-400 bg-slate-100 dark:bg-dark-hover' : 'text-slate-400 hover:text-brand-600 dark:hover:text-brand-400'}`}
        >
          <Smile className="w-4 h-4" />
        </button>
        <button
          type="button"
          // Don't steal the textarea selection before insertMentionTrigger reads it.
          onMouseDown={e => e.preventDefault()}
          onClick={insertMentionTrigger}
          disabled={busy || disabled}
          aria-label="Mention someone"
          title="Mention someone"
          className="w-9 h-9 shrink-0 rounded-full hidden md:flex items-center justify-center text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 hover:bg-slate-100 dark:hover:bg-dark-hover disabled:opacity-40"
        >
          <AtSign className="w-4 h-4" />
        </button>
        {giphyEnabled && (
          <>
            <GifPicker open={gifOpen} onClose={() => setOpenPopover(null)} onSelect={handleGifSelect} />
            <button
              type="button"
              onClick={() => setOpenPopover(p => (p === 'gif' ? null : 'gif'))}
              disabled={busy || disabled}
              aria-label="Send a GIF"
              aria-pressed={gifOpen}
              title="Send a GIF"
              className={`w-9 h-9 shrink-0 rounded-full hidden md:flex items-center justify-center hover:bg-slate-100 dark:hover:bg-dark-hover disabled:opacity-40 ${gifOpen ? 'text-brand-600 dark:text-brand-400 bg-slate-100 dark:bg-dark-hover' : 'text-slate-400 hover:text-brand-600 dark:hover:text-brand-400'}`}
            >
              <Film className="w-4 h-4" />
            </button>
          </>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKey}
          onKeyUp={e => refreshMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onClick={e => refreshMentionQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onPaste={handlePaste}
          onBlur={() => setMentionQuery(null)}
          placeholder={replyTarget ? `Reply to ${replyTarget.authorName}…` : placeholder}
          rows={1}
          style={{ height: textareaHeight }}
          className="flex-1 resize-none rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-dark-border px-3 py-2 text-base md:text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          type="button"
          onClick={submit}
          disabled={sendDisabled}
          style={sendDisabled ? undefined : { backgroundColor: 'var(--chat-accent, #6366f1)' }}
          className={`w-9 h-9 rounded-full text-white flex items-center justify-center ${
            sendDisabled ? 'bg-slate-300 cursor-not-allowed' : 'hover:brightness-110'
          }`}
          aria-label={busy ? 'Sending…' : 'Send'}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

function FmtBtn({ icon: Icon, label, onClick }) {
  return (
    <button
      type="button"
      // Keep the textarea selection alive: prevent the button from stealing
      // focus before the click handler reads selectionStart/selectionEnd.
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="w-7 h-7 rounded flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-dark-hover"
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}

function FmtDivider() {
  return <span className="mx-1 w-px h-4 bg-slate-200 dark:bg-dark-border" aria-hidden="true" />
}
